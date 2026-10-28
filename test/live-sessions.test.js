// test/live-sessions.test.js: the live call in a real browser: replays, several sessions and their tabs, the Claude Code tab VS Code shows, sessions of other tools, and what Claude Code says of its own sessions.
// The setup shared by the live-*.test.js files (temporary folder, stand-in claude, sessions being written, the call watched) is in live-helpers.js, which must be required before server.js.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { tmp, missing, wait, start, session, open, count, closing, closed, YOURS } = require('./live-helpers.js');
let nId = 1e6;   // the ids of the messages written by hand below, apart from those session() gives

test('live call: sessions, tabs and replays', { skip: missing || false, timeout: 600000 }, async (t) => {
  await start(t);

  // this case found a race of the app: right after another call, the list of sessions the server shares for 1.2 s could be older than this session, the first answer after goSession() said no order yet (asked 0), and the next one dropped the pick. currentSession now makes the list again for a session written after it (8 runs out of 8 since, 2 failures in 8 before)
  await t.test('a click that sends the call elsewhere is not undone by an answer that was already on its way', async () => {
    const s = session(), old = path.join(tmp, 'projects', s.proj, 'old.jsonl'), ago = Date.now() - 45 * 60000; s.user('hello'); s.say('Ready.', { end: true });
    fs.writeFileSync(old, [{ type: 'user', message: { role: 'user', content: 'an older conversation' } }, { type: 'assistant', message: { id: 'o1', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }].map((r) => JSON.stringify({ timestamp: new Date(ago).toISOString(), ...r })).join('\n') + '\n'); fs.utimesSync(old, ago / 1000, ago / 1000);
    const c = await open(s); await c.quiet(500); await c.page.evaluate((proj) => goSession(proj, 's'), s.proj); await wait(1000);
    await c.page.evaluate((proj) => { const of = window.fetch; let held = false; window.fetch = function (u) { const p = of.apply(this, arguments); if (held || typeof u !== 'string' || !u.startsWith('/api/current') || !u.includes('pid=s')) return p; held = true; setTimeout(() => goSession(proj, 'old'), 20); return p.then((r) => new Promise((res) => setTimeout(() => res(r), 600))); }; }, s.proj);   // the next answer about the session the call is kept in takes 600 ms, and the click comes in the meantime
    await c.until(() => S.cur && S.cur.id === 'old'); await wait(2500); assert.deepEqual(await c.page.evaluate(() => ({ id: S.cur && S.cur.id, to: S.pick && S.pick.id })), { id: 'old', to: 'old' });   // it used to take the call back
    await c.close();
  });

  await t.test('in a replay too, sub-agents that spoke back to back take turns: never two voices at once', async () => {
    const s = session(), t0 = Date.now() - 3000; s.user('Split the work in three', t0); s.say('Three of you, one part each.', { at: t0 + 1000 });
    for (const k of [1, 2, 3]) { s.launch(k, 'Part ' + k, `Do part ${k} and say where you are.`); await wait(20); }
    for (const k of [1, 2, 3]) { s.say(`PART ${k} is under way, nothing in my way so far.`, { sub: k }); await wait(20); }
    const c = await open(s, false);
    await c.page.evaluate(async (proj) => {
      await setMode('replay'); await loadSession(proj, 's'); S.locked = false; $('#gate').classList.remove('on'); $('#speed').value = $('#speed').max;
      window.__at = 0; window.__most = 0; const o = window.speakLine; window.speakLine = function () { window.__most = Math.max(window.__most, ++window.__at); return o.apply(this, arguments).finally(() => window.__at--); };   // how many voices are in flight
      seekTo(0);
    }, s.proj);
    await c.until(() => !S.playing && window.__said.filter((x) => x.line.includes('PART')).length === 3, null, 60000);
    assert.equal(await c.page.evaluate(() => window.__most), 1, 'voices at once'); assert.deepEqual((await c.lines()).filter((l) => l.includes('PART')).map((l) => l.slice(0, 6)), ['PART 1', 'PART 2', 'PART 3'], 'each in turn, in the order they spoke'); await c.close();
  });

  await t.test('a replay paused while one of them speaks loses no line: it resumes with the one that was cut, then the others', async () => {
    const s = session(), t0 = Date.now() - 3000; s.user('Split the work in three', t0); s.say('Three of you, one part each.', { at: t0 + 1000 });
    for (const k of [1, 2, 3]) { s.launch(k, 'Part ' + k, `Do part ${k} and say where you are.`); await wait(20); }
    for (const k of [1, 2, 3]) { s.say(`PART ${k} is under way, nothing in my way so far.`, { sub: k }); await wait(20); }
    const c = await open(s, false);
    await c.page.evaluate(async (proj) => { await setMode('replay'); await loadSession(proj, 's'); S.locked = false; $('#gate').classList.remove('on'); seekTo(0); }, s.proj);
    await c.heard('PART 1', 60000); assert.equal(await c.page.evaluate(() => S.events[S.idx].text.slice(0, 6)), 'PART 1', 'the place is the line being said, not the last of the group');
    await c.page.evaluate(() => togglePlay()); await wait(500); await c.page.evaluate(() => togglePlay());   // paused in the first of the three, then resumed: it used to go on with the third
    await c.until(() => !S.playing && window.__said.some((x) => x.line.includes('PART 3')), null, 60000);
    assert.deepEqual([...new Set((await c.lines()).filter((l) => l.includes('PART')).map((l) => l.slice(0, 6)))], ['PART 1', 'PART 2', 'PART 3'], 'each is heard, in the order they spoke'); await c.close();
  });

  await t.test('in VS Code the call goes to the Claude Code tab you go to, and stays there until you type somewhere; what the agents write elsewhere does not take it back', async () => {
    const s = session(), old = path.join(tmp, 'projects', s.proj, 'old.jsonl'), ago = Date.now() - 45 * 60000; s.user('hello'); s.say('Ready.', { end: true });
    fs.writeFileSync(old, [{ type: 'user', message: { role: 'user', content: 'an older conversation' } }, { type: 'assistant', message: { id: 'o1', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }].map((r) => JSON.stringify({ timestamp: new Date(ago).toISOString(), ...r })).join('\n') + '\n'); fs.utimesSync(old, ago / 1000, ago / 1000);   // a second session of the same folder, quiet for long enough to have no tab of its own
    const c = await open(s, true, '&embed=1'), tab = (id) => c.page.evaluate((proj, id) => window.postMessage({ agentStandup: 'pin', id, proj, tab: true }, '*'), s.proj, id);   // what extension.js sends when you change tab
    const at = () => c.page.evaluate(() => ({ id: S.cur && S.cur.id, row: !!document.querySelector('#tabs .stab') })), goes = (id) => c.until((k) => S.cur && S.cur.id === k, id);
    await c.quiet(500); assert.deepEqual(await at(), { id: 's', row: false });
    await tab('s'); await wait(2500); assert.deepEqual(await at(), { id: 's', row: false }, 'the tab of the session the call is in: nothing moves, no row of tabs');
    await tab('old'); await goes('old'); await wait(4000); assert.equal((await at()).id, 'old', 'another tab: the call goes there and is kept there');
    s.say('One more thought.', { end: true }); await wait(4000); assert.equal((await at()).id, 'old', 'the other session writes: the call stays');   // it went back to the session written to last after a minute and a half
    s.user('And now this'); await goes('s');   // you type in the other session: the call goes there, nothing was to be let go first
    await tab('old'); await goes('old'); await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=followTab]').click()); await tab('s'); await wait(2500); assert.equal((await at()).id, 'old', '⚙: off');
    await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=followTab]').click());
    await c.page.evaluate((proj) => goSession(proj, 'old', true), s.proj); await tab('s'); await wait(2500); assert.deepEqual([(await at()).id, await c.page.evaluate(() => !!(S.pick && S.pick.pin))], ['old', true], 'pinned (a click on its tab): the Claude Code tabs you go through do not take the call');
    s.user('One last thing'); await goes('s'); await c.until(() => !S.pick); assert.equal(await c.page.evaluate(() => S.pick), null, 'until you ask something in another session: the call goes there, and nothing is pinned any more');
    await c.close();
  });

  await t.test('what an agent has used so far shows next to its name: on its tile, in the camera when it shares its screen, in the list of agents, and it stays in that list once the agent has left', async () => {
    const s = session(), sub = path.join(tmp, 'projects', s.proj, 's', 'subagents', 'agent-a1.jsonl'); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    const chips = () => c.page.evaluate(() => { const txt = (q) => { const e = document.querySelector(q); return e ? e.textContent : null; }; return { tile: txt('#t-a1 .tk'), camera: document.querySelector('#present.on') ? txt('#pcam .tk') : null, list: txt('#roster .rr[data-id="a1"]:not(.left) .rt'), left: txt('#roster .rr.left[data-id="a1"] .rt') }; });
    await c.quiet(500); s.user('Run the tests'); s.launch(1, 'Run the tests', 'Run the whole test suite.');
    fs.appendFileSync(sub, JSON.stringify({ timestamp: new Date().toISOString(), type: 'assistant', message: { id: 'u1', role: 'assistant', model: 'claude-test', stop_reason: 'tool_use', usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'toolu_u1', name: 'Bash', input: { command: 'npm test' } }] } }) + '\n');   // 1,500 tokens: what it read from the cache is not in the headline
    await c.until(() => document.querySelector('#present.on') && document.querySelector('#pcam .tk') && document.querySelector('#pcam .tk').textContent === '⚡1.5k', null, 30000);
    assert.deepEqual(await chips(), { tile: '⚡1.5k', camera: '⚡1.5k', list: '⚡1.5k', left: null });
    await c.page.evaluate(() => { S.gone.add('a1'); paintStates(); }); assert.deepEqual({ ...(await chips()), tile: 0, camera: 0 }, { tile: 0, camera: 0, list: null, left: '⚡1.5k' });   // its tile has left the stage: its line and its count have not
    await c.close();
  });

  await t.test('several sessions at once: a row of tabs from the second one on, each with its state; a visitor when another one stops for you, who takes the call there. The call is in the session you last typed in, or in the one you went to until you type somewhere', async () => {
    const s = session(), dir = path.join(tmp, 'projects', s.proj); s.user('First session'); s.say('Ready.', { end: true });
    const other = (id) => { const f = path.join(dir, id + '.jsonl'), put = (r) => fs.appendFileSync(f, JSON.stringify({ timestamp: new Date().toISOString(), ...r }) + '\n'), msg = (content, stop) => put({ type: 'assistant', message: { id: 'm' + ++nId, role: 'assistant', stop_reason: stop, content } });   // another session of the same folder
      return { user: (text) => put({ type: 'user', message: { role: 'user', content: text } }), say: (text) => msg([{ type: 'text', text }], 'end_turn'), tool: (name, input) => { const tid = 'toolu_' + ++nId; msg([{ type: 'tool_use', id: tid, name, input }], 'tool_use'); return tid; }, result: (tid) => put({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: 'ok' }] } }) }; };
    const c = await open(s), b = other('b'), q = other('q');
    const tabsNow = `[...document.querySelectorAll('#tabs .stab:not(.all)')].map((x) => (x.classList.contains('on') ? '>' : '') + x.querySelector('span').textContent + ' ' + (['blocked', 'working', 'waiting', 'turn', 'idle'].find((k) => x.classList.contains(k)) || '?'))`;
    const row = () => c.page.evaluate(tabsNow), rowIs = (tabs) => c.page.waitForFunction(`${tabsNow}.join('|') === ${JSON.stringify(tabs.join('|'))}`, { timeout: 30000, polling: 100 }).catch(async () => assert.deepEqual(await row(), tabs));   // not there in time: the row as it is
    const visitor = () => c.page.evaluate(() => { const v = document.querySelector('#visit.on'); return v ? { kind: v.classList.contains('blocked') ? 'blocked' : 'turn', says: v.querySelector('.vsay').textContent } : null; }), comes = (kind) => c.page.waitForFunction((k) => { const v = document.querySelector('#visit.on'); return v && v.classList.contains(k); }, { timeout: 30000, polling: 100 }, kind);
    const at = () => c.page.evaluate(() => S.cur && S.cur.id), goes = (id) => c.until((k) => S.cur && S.cur.id === k, id), tabOf = (name) => c.page.evaluate((n) => [...document.querySelectorAll('#tabs .stab:not(.all)')].find((x) => x.querySelector('span').textContent === n).click(), name);
    await c.quiet(500); assert.deepEqual(await row(), [], 'one session: no row');
    b.user('Second session'); const cmd = b.tool('Bash', { command: 'npm test' }); await goes('b'); await rowIs(['First session turn', '>Second session working']);   // a session is started: the call goes there by itself. It stayed where it was, and went there only when that session wrote last
    await tabOf('First session'); await goes('s'); await rowIs(['>First session turn', 'Second session working']); assert.ok((await c.page.evaluate(() => document.querySelector('#tabs .stab.on').textContent)).includes('📌'), 'a click on a tab takes the call there and pins it');
    b.result(cmd); b.say('The tests pass.'); await comes('turn'); let v = await visitor(); assert.match(v.says, /Second session/); assert.match(v.says, /done|finished/); assert.deepEqual(await row(), ['>First session turn', 'Second session turn']);   // its turn is over there
    assert.equal(await at(), 's', 'the other session writes and ends its turn: the call has not moved');
    await c.page.click('#visit .vgo'); await goes('b'); assert.equal(await visitor(), null, 'the call went there: the visitor leaves'); await rowIs(['First session turn', '>Second session turn']);
    assert.ok(!(await c.page.evaluate(() => document.querySelector('#tabs').textContent)).includes('📌'), 'the visitor takes the call there without pinning it'); await c.page.click('#tabs .stab.on'); await wait(1500); assert.deepEqual([await at(), await c.page.evaluate(() => document.querySelector('#tabs .stab.on').textContent.includes('📌'))], ['b', true], 'a click on the call’s own tab pins it there');
    q.user('Third session'); await goes('q'); await rowIs(['First session turn', 'Second session turn', '>Third session working']);   // a third one is started while the call was kept in the second: it goes there, nothing was to be let go first
    await tabOf('First session'); await goes('s'); await rowIs(['>First session turn', 'Second session turn', 'Third session working']);
    const CC = process.env.AGENT_STANDUP_CC_SESSIONS, qst = (st) => { fs.mkdirSync(CC, { recursive: true }); fs.writeFileSync(path.join(CC, '2.json'), JSON.stringify({ pid: process.pid, sessionId: 'q', status: st, ...(st === 'waiting' ? { waitingFor: 'input needed' } : {}), statusUpdatedAt: Date.now() })); };   // what Claude Code writes while its question is open, then once it is answered: a question alone in the transcript is only a guess, which never brings a visitor
    const ask = () => { const tid = q.tool('AskUserQuestion', { questions: [{ question: 'Which one?', header: 'Choice', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false }] }); qst('waiting'); return tid; }, first = ask();
    await comes('blocked'); v = await visitor(); assert.match(v.says, /Third session/); assert.match(v.says, /question/); await rowIs(['>First session turn', 'Second session turn', 'Third session blocked']);   // a question: said as such, in red
    await c.page.click('#visit .vx'); assert.equal(await visitor(), null, '✕ sends the visitor away'); assert.equal(await at(), 's'); const visited = Date.now();
    q.result(first); qst('busy'); await rowIs(['>First session turn', 'Second session turn', 'Third session working']); ask(); await rowIs(['>First session turn', 'Second session turn', 'Third session blocked']);   // answered there, and a second question at once
    assert.equal(await visitor(), null, 'less than 20 s after the last visit: not yet'); await comes('blocked'); assert.ok(Date.now() - visited > 10000); await c.page.click('#visit .vx');   // told when the 20 s are over: it used to be lost
    await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=visits]').click());   // ⚙: no visitor
    b.user('One more thing'); await goes('b'); await rowIs(['First session turn', '>Second session working', 'Third session blocked']);   // you type in the second one: the call is there again
    await tabOf('First session'); await goes('s'); b.say('Done as well.'); await rowIs(['>First session turn', 'Second session turn', 'Third session blocked']);
    await wait(11000); assert.equal(await visitor(), null, 'off in the settings: the tab alone says it');
    await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=visits]').click());
    fs.rmSync(path.join(CC, '2.json'), { force: true }); await c.close();
  });

  await t.test('a session of another tool in the same folder has its tab, which names the tool; in its call the lead says it too', async () => {
    const s = session(), VB = path.join(tmp, 'vibe'), vid = 'session_20261013_100000_abcd1234', vd = path.join(VB, 'logs', 'session', vid), ago = Date.now() - 180000; process.env.AGENT_STANDUP_VIBE = VB; fs.mkdirSync(vd, { recursive: true });
    fs.writeFileSync(path.join(vd, 'meta.json'), JSON.stringify({ start_time: new Date(ago - 60000).toISOString(), environment: { working_directory: '/' + s.proj.slice(1) }, child_sessions: [], title: 'Review the diff' }));   // a Mistral Vibe session started in the folder of the Claude Code one, in a terminal
    fs.writeFileSync(path.join(vd, 'messages.jsonl'), [{ role: 'user', content: 'Review the diff' }, { role: 'assistant', content: 'Nothing to change.' }].map((l) => JSON.stringify(l)).join('\n') + '\n'); fs.utimesSync(path.join(vd, 'messages.jsonl'), ago / 1000, ago / 1000);
    s.user('Claude session'); s.say('Ready.', { end: true }); const c = await open(s);
    const tabs = () => [...document.querySelectorAll('#tabs .stab:not(.all)')].map((x) => (x.classList.contains('on') ? '>' : '') + (x.querySelector('i') ? '[' + x.querySelector('i').textContent + '] ' : '') + x.querySelector('span').textContent).join('|'), role = () => c.page.evaluate(() => document.querySelector('#roster .rr[data-id="main"] .ro').textContent);
    await c.until(`(${tabs})() === '>Claude session|[Vibe] Review the diff'`, null, 30000); assert.equal(await role(), 'Lead', 'a Claude Code call: the lead as it always was');
    await c.page.click('#tabs .stab:not(.on):not(.all)'); await c.until((id) => S.cur && S.cur.id === id, vid); await c.until(`(${tabs})() === 'Claude session|>[Vibe] Review the diff'`); await c.until(() => { const r = document.querySelector('#roster .rr[data-id="main"] .ro'); return r && r.textContent === 'Lead · Vibe'; });
    const was = await c.page.evaluate(() => prefs.proj || ''); await c.page.evaluate((id) => openSession('_vibe', id), vid); await wait(1500);   // the same session opened from the Sessions view or from ⋯
    assert.deepEqual(await c.page.evaluate(() => ({ id: S.cur && S.cur.id, to: S.pick && S.pick.id, proj: prefs.proj || '' })), { id: vid, to: vid, proj: was }, 'the call is kept there, and the project to follow is not “Mistral Vibe”: it used to be, and a window with no folder then never showed a Claude Code session again');
    assert.notEqual(JSON.parse(fs.readFileSync(process.env.AGENT_STANDUP_PREFS, 'utf8')).proj, '_vibe', 'nor is it saved');
    await c.close();
    const d = await open(s, true, `&pin=${vid}&pproj=_vibe`), both = `(${tabs})().split('|').sort().join('|')`;   // the call as the VS Code status bar opens it on the Vibe session: kept there, in a window that still follows its folder
    await d.until(`${both} === '>[Vibe] Review the diff|Claude session'`, null, 30000); assert.deepEqual(await d.page.evaluate(() => ({ id: S.cur.id, to: S.pick && S.pick.id, at: S.pick && S.pick.proj })), { id: vid, to: vid, at: '_vibe' });
    s.user('Back to this one'); await d.until(() => S.cur && S.cur.id === 's' && !S.pick); await d.until(`${both} === '>Claude session|[Vibe] Review the diff'`);   // you type in the Claude Code session of the folder: the call goes there. Opened on a Vibe session, the window used to stay among the Vibe sessions
    await d.close(); delete process.env.AGENT_STANDUP_VIBE;
  });

  await t.test('an editor open on another folder than the sessions: the call goes to the latest session of anywhere, and the tabs show the others too', async () => {
    const s = session(), dir = path.join(tmp, 'projects', s.proj), line = (r) => JSON.stringify({ timestamp: new Date().toISOString(), ...r }) + '\n'; s.user('Wide first'); s.say('Ready.', { end: true });
    fs.writeFileSync(path.join(dir, 'b.jsonl'), line({ type: 'user', message: { role: 'user', content: 'Wide second' } }) + line({ type: 'assistant', message: { id: 'w1', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }));
    const temp = path.join(tmp, 'projects', '-private-var-folders-zz-ab12cd-T-neutral-wide01'); fs.mkdirSync(temp, { recursive: true }); fs.writeFileSync(path.join(temp, 't.jsonl'), line({ type: 'user', message: { role: 'user', content: 'Temp run' } }) + line({ type: 'assistant', message: { id: 'w2', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_w2', name: 'Bash', input: { command: 'ls' } }] } }));   // a session a script started in the temporary folder, at work, and the latest
    await wait(1300); const c = await open({ proj: '-no-session-here' }), names = () => c.page.evaluate(() => [...document.querySelectorAll('#tabs .stab:not(.all) span')].map((x) => x.textContent));   // 1.3 s: the list of sessions is shared for 1.2 s, and the row shows the first eight sessions it saw; these two must be in the first list this page gets
    const ask = (proj) => c.page.evaluate(async (p) => (await fetch('/api/current?proj=' + p)).json(), proj); assert.equal((await ask('-no-session-here')).wide, 1); assert.equal((await ask(s.proj)).wide, undefined, 'a folder that has sessions: only those');
    await c.until(() => { const n = [...document.querySelectorAll('#tabs .stab:not(.all) span')].map((x) => x.textContent); return n.includes('Wide first') && n.includes('Wide second'); }, null, 30000);   // there used to be no row at all: one session on screen and nothing to say there was another
    assert.ok(['s', 'b'].includes(await c.page.evaluate(() => S.cur.id)), 'the call is in the latest session'); assert.ok((await names()).length >= 2);
    assert.equal(await c.page.evaluate(() => (S.rows.find((r) => r.title === 'Temp run') || {}).tmp), 1); assert.ok(!(await names()).includes('Temp run'), 'not the session in the temporary folder: no tab, and the call is not there');
    await c.page.evaluate((proj) => goSession(proj, 's'), s.proj); await c.until(() => S.cur && S.cur.id === 's' && S.pick && S.pick.id === 's'); await wait(3500); assert.ok((await names()).includes('Wide second'), 'a call kept in a session you went to keeps the other tabs');
    await c.close();
  });

  await t.test('a menu left open for minutes, the call opened on it: the lead needs you and shows what it asks, not "your turn"', async () => {
    const s = session(), at = Date.now() - 300000, CC = process.env.AGENT_STANDUP_CC_SESSIONS; s.user('Build it', at - 60000); s.tool('Bash', { command: 'npm run build', description: 'Build' }, { at });
    fs.mkdirSync(CC, { recursive: true }); fs.writeFileSync(path.join(CC, '1.json'), JSON.stringify({ pid: process.pid, sessionId: 's', status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: at + 5000 }));   // what Claude Code writes while its permission menu is open
    const c = await open(s);
    try {
      await c.until(() => agentState('main', Date.now()).k === 'blocked', null, 20000); await wait(1500); assert.ok(!(await c.page.evaluate(() => document.querySelector('#askc').classList.contains('on'))), 'no card unless asked for in the settings');
      await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=askCard]').click());
      await c.until(() => document.querySelector('#askc').classList.contains('on'), null, 20000);   // the page used to say "✓ your turn · 5 min" past 3 minutes of quiet, with no card
      assert.match(await c.page.evaluate(() => agentState('main', Date.now()).txt), /needs you 5 min/, 'Claude Code says a menu is open: certain, no question mark'); assert.match(await c.page.evaluate(() => document.querySelector('#askc').innerText), /npm run build/);
      assert.deepEqual(await c.page.evaluate(() => [document.querySelector('#sline').className.split(' ')[0], document.querySelector('#attn').hidden]), ['blocked', true], 'the status line says it in red, once: no second red line under it for the same agent');
      const posts = []; c.page.on('request', (q) => { if (q.url().endsWith('/api/answer')) posts.push(q.postData()); }); await c.page.evaluate(() => pillGo()); await c.until(() => true); await wait(800);
      assert.deepEqual(posts.map((b) => JSON.parse(b).id), ['s'], 'a click on it also asks to open the session where it can be answered');
      await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=askCard]').click());
    } finally { fs.rmSync(path.join(CC, '1.json'), { force: true }); }   // every session of this file is called s
    await c.close();
  });
});
