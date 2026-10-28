// test/live-call.test.js: the live call in a real browser: joining the call, orders and lines: what was said before is not said again, and every line, yours too, is said once.
// The setup shared by the live-*.test.js files (temporary folder, stand-in claude, sessions being written, the call watched) is in live-helpers.js, which must be required before server.js.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { tmp, missing, wait, start, session, open, count, closing, closed, YOURS } = require('./live-helpers.js');

test('live call: joining, orders and lines', { skip: missing || false, timeout: 600000 }, async (t) => {
  await start(t);

  await t.test('joining a call that is over says nothing; what comes next is said once, also after a reload', async () => {
    const s = session(), old = Date.now() - 600000; s.user('OLD order', old); s.say('OLD answer, all done.', { at: old + 5000, end: true });
    const c = await open(s); await c.quiet(); assert.deepEqual(await c.lines(), []);
    s.user('NEW order'); await wait(1500); s.say('NEW answer.', { end: true }); await c.heard('NEW answer'); await c.quiet();
    await c.page.evaluate(() => { S.cur = null; }); await wait(3000); await c.quiet();   // what a rewritten transcript or a server restart triggers
    const l = await c.lines(); assert.equal(count(l, 'OLD'), 0); assert.equal(count(l, 'NEW order'), 1); assert.equal(count(l, 'NEW answer'), 1); await c.close();
  });

  await t.test('joining while the agents are at work: the last seconds are said, not what came before', async () => {
    const s = session(), now = Date.now(); s.user('EARLIER order', now - 40000); s.say('EARLIER line.', { at: now - 30000 }); s.tool('Bash', { command: 'ls' }, { at: now - 20000 }); s.say('RECENT line.', { at: now - 5000 }); s.tool('Bash', { command: 'npm test' }, { at: now - 2000 });
    const c = await open(s); await c.heard('RECENT line'); await c.quiet(1000); const l = await c.lines(); assert.equal(count(l, 'EARLIER'), 0); assert.equal(count(l, 'RECENT line'), 1); await c.close();
  });

  await t.test('the lead answers an order when it goes to its tools without a word, also after a long order; not when it spoke', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Fix the slow login'); await wait(2500); s.tool('Read', { file_path: '/x/src/server.js' }); await c.heard('server.js');
    await c.quiet(500); s.say('The login waits on a slow query.', { end: true }); await c.heard('slow query'); await c.quiet(500);
    s.user('Please go through the whole authentication module, list every place where a session token is read or written, check each one against the new expiry rule, and tell me which ones still need to change before the release.'); await wait(2000);
    let id = s.tool('Bash', { command: 'npm test', description: 'Run the test suite' });
    for (let k = 0; k < 8; k++) { await wait(1000); s.result(id, 'ok'); id = s.tool('Read', { file_path: `/x/auth/part${k}.js` }); }   // the lead goes on while the order is still being read: its first tool is no longer "just now"
    await c.heard('Run the test suite', 30000);
    await c.quiet(500); s.say('Two places still need to change.', { end: true }); await c.heard('Two places'); await c.quiet(500);
    s.user('And what do you think?'); await wait(2000); s.say('I think the query needs an index.'); await wait(300); s.tool('Grep', { pattern: 'CREATE INDEX' }); await c.heard('needs an index'); await c.quiet();
    const lead = await c.lines('main'); assert.equal(lead.filter((l) => /^(Got it|Okay|On it|Sure|Right)\./.test(l)).length, 2, lead.join(' | ')); await c.close();
  });

  await t.test('a sub-agent answers its order; a last line that becomes a report afterwards counts as one, without being read again', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Check the tests'); await wait(1500); s.say('I will hand this over.'); await wait(1500);
    const id = s.launch(1, 'Run the tests', 'Run the whole test suite and report every failure with its file and line.');
    for (let k = 0; k < 8; k++) { await wait(1000); s.result(s.tool('Bash', { command: 'npm test' }, { sub: 1 }), 'ok', { sub: 1 }); }
    await c.until(() => window.__said.some((x) => x.id === 'a1' && x.label === '💬'), null, 30000);   // the answer to the order
    s.say('REPORT: 40 tests pass and two fail in the auth module.', { sub: 1 }); await c.heard('REPORT: 40 tests');   // the page has it as an ordinary line
    await wait(3000); s.result(id, 'REPORT: 40 tests pass and two fail in the auth module.');   // Claude Code writes the completion a few seconds later
    await c.until(() => S.status.a1 === 'done' && S.events.some((e) => e.agent === 'a1' && e.kind === 'report'), null, 15000); await c.quiet();
    assert.equal(count(await c.lines(), 'REPORT: 40 tests'), 1); assert.ok(await c.page.evaluate(() => !!document.querySelector('#log .row.report'))); await c.close();
  });

  await t.test('an order typed while the lead works reaches the call, once, and no line is said twice', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Start the build'); await wait(1500); s.say('FIRST lead line.'); await c.heard('FIRST lead line'); const typed = Date.now(); await wait(4000);
    s.say('SECOND lead line.'); await c.heard('SECOND lead line'); await c.quiet(500);
    s.queued('ORDER TYPED MEANWHILE', typed); await c.heard('ORDER TYPED MEANWHILE'); await wait(1000); s.say('THIRD lead line.', { end: true }); await c.heard('THIRD lead line'); await c.quiet();
    const l = await c.lines(); for (const x of ['FIRST lead line', 'SECOND lead line', 'ORDER TYPED MEANWHILE', 'THIRD lead line']) assert.equal(count(l, x), 1, x + ' in ' + l.join(' | ')); await c.close();
  });

  await t.test('tool calls of one message written one after the other all reach the call', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Look around'); await wait(1500); s.say('Looking.'); await c.heard('Looking'); await c.quiet(300);
    s.tool('Read', { file_path: '/x/one.js' }, { id: 'mPar' }); await wait(1200); s.tool('Read', { file_path: '/x/two.js' }, { id: 'mPar' }); await wait(1200); s.tool('Read', { file_path: '/x/three.js' }, { id: 'mPar' });
    await c.until(() => (S.tc.main || 0) === 3, null, 15000); assert.equal(await c.page.evaluate(() => S.events.filter((e) => e.kind === 'tools').reduce((n, e) => n + e.tools.length, 0)), 3); await c.close();
  });

  await t.test('your own line is always voiced: typed long before it was delivered, or in the middle of a backlog', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Start', Date.now() - 170000); await wait(1200); s.say('Working on it.', { at: Date.now() - 165000 }); await c.heard('Working on it'); await c.quiet(500);   // dated as if the command below had really run for two minutes
    const id = s.tool('Bash', { command: 'sleep 140' }, { at: Date.now() - 150000 }); await wait(1500); s.result(id, 'ok'); s.queued('ORDER TYPED TWO MINUTES AGO', Date.now() - 130000); await wait(300); s.say('Noted.', { end: true });   // a long command, an order typed 20 s into it: Claude Code hands the order over when the command returns, stamped with the time it was typed
    await c.heard('ORDER TYPED TWO MINUTES AGO'); await c.heard('Noted'); await c.quiet(500);
    for (let k = 0; k < 30; k++) { if (k === 12) s.user('ORDER IN THE BACKLOG'); s.say(`Backlog line ${k} of the lead, long enough to take a moment to read out loud.`); }   // written at once: the call is far behind and skips ahead
    s.say('End of the backlog.', { end: true }); await c.heard('End of the backlog', 120000); await c.quiet(500);
    const mine = await c.page.evaluate(() => window.__voice.filter((x) => x.id === 'user'));
    for (const x of ['ORDER TYPED TWO MINUTES AGO', 'ORDER IN THE BACKLOG']) { const hit = mine.filter((y) => y.text.includes(x)); assert.equal(hit.length, 1, x + ' said ' + hit.length + ' times'); assert.equal(hit[0].silent, false, x + ' was shown without a voice'); }
    await c.close();
  });

  await t.test('pausing and resuming at the end of a live call does not repeat the last line', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('One thing'); await wait(1200); s.say('LAST line of the call.', { end: true }); await c.heard('LAST line'); await c.quiet(500);
    await c.page.evaluate(() => togglePlay()); await wait(800); await c.page.evaluate(() => togglePlay()); await c.quiet(); assert.equal(count(await c.lines(), 'LAST line'), 1); await c.close();
  });

  await t.test("a fork joins as the lead's twin and follows the lead's name; the effort, the advisor and the cost Claude Code writes are shown", async () => {   // Claude Code 2.1.302: forks on by default; cost-state since 2.1.300; effort and advisorModel since 2.1.275
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    const dir = path.join(tmp, 'projects', s.proj), raw = (f, r) => fs.appendFileSync(f, JSON.stringify({ timestamp: new Date().toISOString(), ...r }) + '\n');
    s.user('Check it with a fork'); await wait(800);
    raw(path.join(dir, 's.jsonl'), { type: 'assistant', effort: 'max', perTurnEffort: 'max', advisorModel: 'claude-opus-5-5', message: { id: 'mEff', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: null, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: 'Forking now.' }] } });
    const id = s.launch(9, 'fork check', 'Say which file', true); fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a9.meta.json'), JSON.stringify({ agentType: 'fork', isFork: true, description: 'fork check', toolUseId: id }));
    s.result(id, 'Async agent launched successfully.\nagentId: a9'); await wait(800); s.say('It is note.txt.', { sub: 9 });
    await c.until(() => S.agents.a9 && S.effort.main === 'max', null, 20000);
    const id8 = s.launch(8, 'review', 'Review it', true); s.result(id8, 'Async agent launched successfully.\nagentId: a8'); await wait(500); s.say('Reviewed.', { sub: 8 }); await c.until(() => S.agents.a8, null, 20000);   // a sub-agent of its own, not a fork
    assert.deepEqual(await c.page.evaluate(() => [S.agents.a9.name, !!S.agents.a9.twin, S.agents.a9.shirt === S.agents.main.shirt, S.adv.main]), ['Margot 2', true, true, 'claude-opus-5-5']);
    await c.page.evaluate(() => { window.__named = () => [S.agents.main.name, S.agents.a9.name, document.querySelector('#t-main .tag b').textContent, document.querySelector('#t-a9 .tag b').textContent]; });
    const lead = (v) => c.page.evaluate((v) => { const el = document.querySelector('#leadName'); el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); return [...window.__named(), 'leadName' in prefs ? prefs.leadName : 'unset']; }, v);   // ⚙ → All settings → Lead agent name
    assert.deepEqual(await lead('Captain <Hook> & Co'), ['Captain Hook Co', 'Captain Hook Co 2', 'Captain Hook Co', 'Captain Hook Co 2', 'Captain Hook Co'], 'plain text only, and the fork follows');
    assert.deepEqual(await lead('Abcdefghijklmnopqrstuvwxyz'), ['Abcdefghijklmnopqrstuvwx', 'Abcdefghijklmnopqrstuvwx 2', 'Abcdefghijklmnopqrstuvwx', 'Abcdefghijklmnopqrstuvwx 2', 'Abcdefghijklmnopqrstuvwx'], '24 characters at most');
    assert.deepEqual(await c.page.evaluate(() => { APP.lead = 'Iris'; leadField(); renameLead(); const r = [...window.__named(), document.querySelector('#leadName').disabled, document.querySelector('#leadName').value]; APP.lead = ''; leadField(); renameLead(); return r; }), ['Iris', 'Iris 2', 'Iris', 'Iris 2', true, 'Iris'], 'the editor’s agentStandup.leadName wins, and the field says so');
    assert.deepEqual(await lead('  '), ['Margot', 'Margot 2', 'Margot', 'Margot 2', 'unset'], 'empty: Margot again');
    const own = await c.page.evaluate(() => S.agents.a8.name), sub = () => c.page.evaluate(() => [S.agents.a8.name, document.querySelector('#t-a8 .tag b').textContent]);
    await lead(own.toUpperCase()); const [was, tile] = await sub(); assert.notEqual(was.toLowerCase(), own.toLowerCase(), 'a sub-agent never keeps the lead’s new name, whatever the capitals'); assert.equal(tile, was);
    await lead(''); assert.deepEqual(await sub(), [own, own], 'and gets its own name back, as a reload would give it');
    assert.equal(await c.page.evaluate(() => { const lead = prefs.leadName, saved = { ...nameBook }; prefs.leadName = NAMES[5]; NAMES.forEach((n, i) => { nameBook['x' + i] = n; }); const n = uniqueName('xx', 5); for (const k in nameBook) delete nameBook[k]; Object.assign(nameBook, saved); if (lead) prefs.leadName = lead; else delete prefs.leadName; return n.startsWith(NAMES[5] + ' '); }), false, 'every name taken: the number never follows the lead’s name, it would read as a fork');
    await c.until(() => /max/.test(document.querySelector('#t-main .tk').textContent), null, 10000);   // a costly effort shows on the tile
    s.say('Done.', { end: true }); fs.appendFileSync(path.join(dir, 's.jsonl'), JSON.stringify({ type: 'cost-state', totalCostUSD: 0.4213 }) + '\n');   // written when the process ends: no time of its own
    await c.until(() => S.cost && S.cost.usd === 0.4213 && S.cost.final, null, 20000); await c.quiet(500);
    await c.page.evaluate(() => openRecap()); assert.match(await c.page.evaluate(() => document.querySelector('#recap .kpis').textContent), /💵 \$0\.42cost/); assert.match(await c.page.evaluate(() => document.querySelector('#tok').title), /💵 \$0\.42/);
    await c.close();
  });
});
