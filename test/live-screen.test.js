// test/live-screen.test.js: the live call in a real browser: what the call shows beside what it says (thoughts, files, artifacts), and the languages and voices it speaks in.
// The setup shared by the live-*.test.js files (temporary folder, stand-in claude, sessions being written, the call watched) is in live-helpers.js, which must be required before server.js.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { tmp, missing, wait, start, session, open, count, closing, closed, YOURS } = require('./live-helpers.js');

test('live call: what the call shows, its languages and voices', { skip: missing || false, timeout: 600000 }, async (t) => {
  await start(t);

  await t.test('an agent at work for a while thinks to itself: its own reasoning when the session has it, else what it is doing; shown, not said, gone when it speaks', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Why is the login slow?'); await c.heard('Why is the login slow'); await wait(1500);
    s.think('The query in db/schema.sql scans the whole table, so the login is slow. I should look at the index before anything else.', { id: 'mTh' }); const id = s.tool('Bash', { command: 'psql -f explain.sql', description: 'Explain the login query' }, { id: 'mTh' });   // (a dot inside a file name does not end the sentence)
    await c.until(() => { const b = document.querySelector('#t-main.musing .bubble'); return b && b.textContent.includes('db/schema.sql scans the whole table, so the login is slow.'); }, null, 45000);   // its own words come first, in whole sentences
    assert.equal(await c.page.evaluate(() => S.speakers.size), 0); assert.equal(count(await c.lines(), 'scans the whole table'), 0, 'a thought is not a spoken line');
    s.result(id, 'Seq Scan on users'); s.say('It was the missing index.', { end: true }); await c.heard('It was the missing index'); assert.equal(await c.page.evaluate(() => !!document.querySelector('#t-main.musing')), false);
    await c.quiet(500); s.user('Then fix it'); await wait(1500); s.say('I will hand the migration over.'); await wait(1000); s.launch(1, 'Check the migration', 'Write the migration that adds the index and check it on a copy of the database.');
    const run = s.tool('Bash', { command: 'npm run migrate:check', description: 'Check the migration' }, { sub: 1 });   // no reasoning kept for this one: the thought is about what it is on
    await c.until(() => { const b = document.querySelector('#t-a1.musing .bubble'); return b && b.textContent.includes('Check the migration'); }, null, 60000);
    assert.equal((await c.said()).filter((x) => x.id === 'a1' && x.line.includes('Check the migration')).length, 0); s.result(run, 'ok', { sub: 1 }); await c.close();
  });

  await t.test('the files made for you show under the call when the turn ends: those the lead names, else the documents; a click shows the file in its folder', async () => {
    const server = require('../server.js'), run = server._reveal.run, shown = []; server._reveal.run = (f) => shown.push(f); t.after(() => { server._reveal.run = run; });   // no Finder window during the tests
    const real = path.join(__dirname, '..', 'README.md'), s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    const mark = "(b) => b.querySelector('span').textContent + (b.classList.contains('new') ? '*' : '') + (b.classList.contains('gone') ? '!' : '')";
    const strip = () => c.page.evaluate(`({ on: document.querySelector('#files').classList.contains('on'), names: [...document.querySelectorAll('#files .sfc[data-f]')].map(${mark}), more: (document.querySelector('#files .more') || {}).textContent || '' })`);
    const shows = (names) => c.page.waitForFunction(`document.querySelector('#files.on') && [...document.querySelectorAll('#files .sfc[data-f]')].map(${mark}).join('|') === ${JSON.stringify(names.join('|'))}`, { timeout: 30000, polling: 100 });
    const write = (file) => s.result(s.tool('Write', { file_path: file, content: 'x' }), 'File created');
    await c.quiet(500); assert.deepEqual(await strip(), { on: false, names: [], more: '' });   // a turn that created nothing
    s.user('Write the report'); await c.heard('Write the report');
    write(real); write('/x/docs/notes.md'); write('/x/src/helper.js'); write(path.join(tmp, 'scratch.js'));   // a source file is not made for you; a scratch file in a temporary folder is not even a file of the session
    s.result(s.tool('Write', { file_path: '/x/docs/refused.md', content: 'x' }), 'Permission denied', { err: true }); s.result(s.tool('Edit', { file_path: '/x/src/app.js', old_string: 'a', new_string: 'b' }), 'ok');   // nor is a write that failed, nor a file that was only changed
    await wait(2500); assert.equal((await strip()).on, false, 'nothing shows while the lead works');
    s.say('The report is written.', { end: true }); await shows(['notes.md*', 'README.md*']); assert.equal((await strip()).more, '+1');   // no file named: the documents
    await c.page.click('#files .sfc[data-f$="README.md"]'); await wait(600); assert.deepEqual(shown, [real]);
    await c.page.click('#files .sfc[data-f="/x/docs/notes.md"]'); await shows(['notes.md*!', 'README.md*']); assert.deepEqual(shown, [real]);   // no longer there: said so, and nothing is opened
    await c.page.click('#files .more'); assert.deepEqual(await c.page.evaluate(() => [...document.querySelectorAll('#fpop .sfr b')].map((b) => b.textContent)), ['helper.js', 'notes.md', 'README.md']);   // the list has them all
    await c.page.keyboard.press('Escape'); assert.equal(await c.page.evaluate(() => !!document.querySelector('#fpop')), false);
    s.user('Now a test for the login'); await c.page.waitForFunction(() => !document.querySelector('#files.on'), { timeout: 30000 });   // the next turn: the line goes away until it ends
    write('/x/docs/second.md'); write('/x/test/login.test.js'); write('/x/test/old-login.test.js');
    s.say('I added `test/login.test.js`, run it to check.', { end: true }); await shows(['login.test.js*', 'notes.md!', 'README.md']); assert.equal((await strip()).more, '+3');   // the one the lead names, and only that one of this turn
    await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=files]').click()); assert.equal((await strip()).on, false);   // ⚙ › All settings › Display: off
    await c.page.evaluate(() => document.querySelector('#prefs .mi[data-t=files]').click()); await shows(['login.test.js*', 'notes.md!', 'README.md']);
    const stat = server._reveal.stat, there = { '/x/out/report.pdf': Date.now() + 60000, '/x/out/data.csv': Date.now() + 60000, '/x/old/brief.md': Date.now() - 3600000 }; server._reveal.stat = (f) => (f in there ? { isFile: () => true, mtimeMs: there[f] } : stat(f)); t.after(() => { server._reveal.stat = stat; });   // no file is written outside the test's folder: the server is told what is there, and since when
    s.user('Export it as a PDF'); await c.page.waitForFunction(() => !document.querySelector('#files.on'), { timeout: 30000 });
    s.result(s.tool('Bash', { command: 'cd /x && python3 make.py --out=out/report.pdf && cat old/brief.md && rm out/draft.pdf' }), 'Wrote 3 pages.\nAlso saved /x/out/data.csv');
    s.say('The export is in `report.pdf`. I used brief.md, and draft.pdf is gone.', { end: true }); await shows(['report.pdf*', 'login.test.js', 'notes.md!', 'README.md']);   // a document a command made, which the lead names: not the one the command only read, nor the one it removed, nor the one nobody names
    await c.page.click('#files .sfc[data-f="/x/out/report.pdf"]'); await wait(600); assert.deepEqual(shown, [real, '/x/out/report.pdf']);
    await c.close();
  });

  await t.test('an artifact the session publishes is shared in a browser window, kept in the line of files and pinned on a click; its page reaches neither the app nor the network', async () => {
    const s = session(), fp = '/tmp/scratch/report.html', url = 'https://claude.ai/artifact/AbCdEf123456', main = path.join(tmp, 'projects', s.proj, 's.jsonl');
    const published = (id, seq) => fs.appendFileSync(main, JSON.stringify({ timestamp: new Date().toISOString(), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Published at ' + url }] }, toolUseResult: { url, title: 'Report', ...(seq ? { seq } : {}) } }) + '\n');   // what Claude Code notes beside the answer of a publish
    s.user('Publish the report.'); s.say('I write the report, then I publish it.');
    const c = await open(s), out = []; c.page.on('response', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) out.push(r.url()); });
    const frame = () => c.page.frames().find((x) => x.url().includes('/api/artifact')), inFrame = async (fn) => { for (let i = 0; i < 80; i++) { try { const v = frame() && await frame().evaluate(fn); if (v) return v; } catch {} await wait(100); } return null; };   // the frame is there before its page is
    await wait(1000); s.result(s.tool('Write', { file_path: fp, content: '<title>Report</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><h1 id="h">Totals</h1>' }), 'File created'); await wait(500);
    const p1 = s.tool('Artifact', { file_path: fp, description: 'The totals of the quarter.' }); await wait(700); published(p1);
    await c.until(() => !!document.querySelector('#present.on .pwin.web iframe[sandbox="allow-scripts"]'));
    assert.equal(await inFrame(() => document.querySelector('#h') && document.querySelector('#h').textContent + '|' + window.origin), 'Totals|null');   // the page the session wrote, in an origin of its own
    assert.equal(await inFrame(() => fetch('/api/sessions').then(() => 'answered', () => 'refused')), 'refused'); assert.equal(await inFrame(() => fetch('https://example.com/').then(() => 'answered', () => 'refused')), 'refused');
    assert.equal(await c.page.evaluate(() => document.querySelector('#ptitle').textContent + '|' + document.querySelector('.purl').textContent + '|' + document.querySelector('#pstat').textContent), 'Report|🔒 claude.ai/artifact/AbCdEf123456|The totals of the quarter.');
    const left = [], sink = require('http').createServer((q, r) => { left.push(q.url); r.end('elsewhere'); }).listen(0, '127.0.0.1'); await new Promise((r) => sink.once('listening', r));   // another address, on this machine: what a page would reach by taking its own frame there
    await frame().evaluate((to) => { location.href = to; }, 'http://127.0.0.1:' + sink.address().port + '/?said=Totals').catch(() => {}); await wait(1200); sink.close(); assert.deepEqual(left, [], 'a page cannot take its frame elsewhere either');
    s.say('The report is published.', { end: true }); await c.until(() => !!document.querySelector('#files.on [data-a]'), null, 40000);
    await c.until(() => !document.querySelector('#present.on'), null, 40000); assert.equal(await c.page.evaluate(() => document.querySelectorAll('iframe').length), 0);   // the window closes by itself, and its page does not go on running behind it
    await c.page.click('#files [data-a]'); await c.until(() => !!document.querySelector('#present.on.pin .pwin.web iframe')); assert.equal(await c.page.evaluate(() => document.querySelector('.pweb').style.getPropertyValue('--z')), '1.000');   // pinned: at its real size
    s.user('A shorter title.'); await wait(500); s.result(s.tool('Bash', { command: 'npm test' }), 'ok'); await wait(700); assert.ok(await c.page.evaluate(() => !!document.querySelector('#present.on.pin .pwin.web iframe')), 'pinned, it stays up while the team works');
    s.result(s.tool('Edit', { file_path: fp, old_string: 'Totals', new_string: 'Sum' }), 'ok'); await wait(400); const p2 = s.tool('Artifact', { file_path: fp, url }); await wait(500); published(p2, 2);
    await c.until((id) => { const x = document.querySelector('#present.pin .pweb iframe'); return !!x && x.src.includes(id); }, p2); assert.equal(await inFrame(() => document.querySelector('#h') && document.querySelector('#h').textContent === 'Sum' && 'Sum'), 'Sum');   // published again: the pinned window shows the new version
    assert.equal(await c.page.evaluate(() => [...document.querySelectorAll('.pnav .pnn')].map((x) => x.textContent).join()), 'v2');
    await c.page.keyboard.press('Escape'); await c.until(() => !document.querySelector('#present.on') && !S.artPin && !document.querySelector('#present iframe'));
    assert.deepEqual(out, [], 'nothing was fetched from outside'); await c.close();
  });

  await t.test('with a Spanish interface the call is held in Spanish, and says so once with the way to turn it off: the session is translated into it, the built-in lines are Spanish, and a line gets the voice of its language', { skip: process.platform === 'win32' }, async () => {
    const s = session(), old = Date.now() - 600000; s.user('OLD order', old); s.say('OLD answer, all done.', { at: old + 5000, end: true }); const c = await open(s, true, '&lang=es'); await c.quiet();
    const note = () => c.page.evaluate(() => (getComputedStyle(document.querySelector('#trNote')).display === 'none' ? null : document.querySelector('#trNoteT').textContent));
    assert.deepEqual(await c.page.evaluate(() => [CALL(), getComputedStyle(document.querySelector('#callTrMi')).display !== 'none', document.querySelector('#callTrMi .sw').classList.contains('on')]), ['es', true, true], 'a Spanish interface means a Spanish call, as a French one does; the switch that turns it off is there');
    assert.equal(await note(), 'La llamada ahora se traduce al español, con tu Claude Code.', 'the first time, the call says that it is translated and with what');
    await c.page.click('#trNoteOff'); await c.until(() => CALL() === 'en' && !document.querySelector('#callTrMi .sw').classList.contains('on')); assert.deepEqual(await c.page.evaluate(() => [prefs.callTr, document.querySelector('#callTrMi .sw').classList.contains('on'), voiceLang('He terminado la tarea y todo está listo.'), voiceLang('OK.')]), [false, false, 'es', 'en'], 'turned off from the note: nothing is translated, the switch follows, and a Spanish line has a Spanish voice all the same');
    await c.page.evaluate(() => { prefs.callTr = true; return setLang('es'); }); assert.equal(await c.page.evaluate(() => CALL()), 'es'); assert.equal(await note(), null, 'said once');
    s.user('Please finish the work.'); await wait(1500); s.say('The work is done and the tests pass.', { end: true });
    await c.heard('Ya está, todo listo y sin errores [The work is done and the tests pass.]'); await closed(c, 1);
    assert.match((await closing(c))[0], /(Tu turno|Te toca|Te devuelvo la palabra)\.$/, 'the lead closes in Spanish'); assert.equal(count(await c.lines(), 'Ya está, todo listo y sin errores [Please finish the work.]'), 1, 'your own line is translated too');
    assert.deepEqual(await c.page.evaluate(() => ['He terminado la tarea y todo está listo.', 'Un momento, está cargando.', 'The build is done and all the tests pass now.', 'OK.'].map(voiceLang)), ['es', 'es', 'en', 'es'], 'Spanish unless a line is plainly English');
    await c.page.evaluate(() => setLang('pt-BR')); assert.deepEqual(await c.page.evaluate(() => [CALL(), voiceLang('Terminei a tarefa e está tudo pronto.'), LEAD[CALL()].any, trMem.has('The work is done and the tests pass.')]), ['pt', 'pt', 'Vou começar.', false], 'another language of the call: its own lines, and nothing kept from the Spanish one');
    await c.page.evaluate(() => setLang('de')); assert.deepEqual(await c.page.evaluate(() => [CALL(), voiceLang('OK.'), voiceLang('Voici le rapport, il est dans le dossier.')]), ['en', 'en', 'fr'], 'an interface language the call is not held in: the session as it is');
    assert.equal(await c.page.evaluate(() => getComputedStyle(document.querySelector('#callTrMi')).display), 'none', 'the switch is offered for Spanish and Portuguese only'); await c.page.evaluate(async () => { prefs.callTr = true; delete prefs.callTrSeen; await setLang('en'); savePrefs(); }); await wait(700); await c.close();   // the note saved the settings while the page was in Spanish: put back for the tests that follow
  });

  await t.test('the real voices are the default and babble until they are installed; the call says they exist, once; the cartoon and Simlish styles are gone and whoever had one is moved; a system voice reads a line of a language the model lacks', async () => {
    const s = session(), old = Date.now() - 600000; s.user('OLD order', old); s.say('OLD answer, all done.', { at: old + 5000, end: true }); const c = await open(s); await c.quiet();
    assert.deepEqual(await c.page.evaluate(() => [[...document.querySelectorAll('#vstyle option')].map((o) => o.value), prefs.vstyle, TTS.engine, babbles()]), [['animal', 'kokoro'], 'kokoro', 'system', true], 'nothing is installed here: the real voices are chosen, and babble');
    const stored = async (v) => { await c.page.evaluate((v) => { prefs.vstyle = v; prefs.vstyleChosen = true; prefs.voiceOffer = 'no'; savePrefs(); }, v); await wait(700); await c.page.reload(); await c.page.waitForFunction('typeof S !== "undefined" && S.cur', { timeout: 15000 }); return c.page.evaluate(() => [prefs.vstyle, prefs.voiceOffer || null, babbles()]); };   // what a person who had chosen that style, and closed the offer, finds at the next start
    assert.deepEqual([await stored('cartoon'), await stored('sims'), await stored('animal')], [['kokoro', null, true], ['animal', 'no', true], ['animal', 'no', true]], 'the cartoon style becomes the natural voices, offered once more; Simlish becomes the other babble; Animal Crossing stays');
    await c.page.evaluate(() => { prefs.vstyle = 'kokoro'; delete prefs.vstyleChosen; delete prefs.voiceOffer; savePrefs(); }); await wait(700); await c.page.click('#gB'); await c.until(() => !document.querySelector('#gate.on'));   // the page was loaded again: joined again, since a line that offers something waits for the call
    const offer = () => c.page.evaluate(() => (getComputedStyle(document.querySelector('#vOffer')).display === 'none' ? null : document.querySelector('#vOfferT').textContent + ' | ' + document.querySelector('#vOfferB').textContent));
    assert.equal(await offer(), null, 'voices are off in these tests: nothing is offered'); const npm = await c.page.evaluate(async () => (await (await fetch('/api/kokoro')).json()).npm);
    await c.page.evaluate(() => { prefs.voice = true; return voiceOffer(); }); assert.equal(await offer(), npm ? 'Your agents can speak with real voices. | Install (750 MB)' : null, 'voices on and the real ones not installed: the call says they exist');
    if (npm) { await c.page.click('#vOfferX'); await c.until(() => getComputedStyle(document.querySelector('#vOffer')).display === 'none'); assert.equal(await c.page.evaluate(() => prefs.voiceOffer), 'no'); await c.page.evaluate(() => voiceOffer()); assert.equal(await offer(), null, 'closed once, it does not come back'); }
    await c.page.evaluate(() => { prefs.voice = false; delete prefs.voiceOffer; savePrefs(); });
    assert.equal(await c.page.evaluate(async () => { const of = window.fetch, was = prefs.lang; window.fetch = (u, o) => (u === '/api/kokoro' ? Promise.resolve(new Response(JSON.stringify({ installed: true, ready: true, g2p: false, npm: true, g2pMb: 18, sizeMb: 750 }))) : of(u, o));
      prefs.voice = true; prefs.lang = 'fr'; await voiceOffer(); const said = getComputedStyle(document.querySelector('#vOffer')).display === 'none' ? null : document.querySelector('#vOfferT').textContent + ' | ' + document.querySelector('#vOfferB').textContent;
      prefs.lang = was; prefs.voice = false; window.fetch = of; await voiceOffer(); return said; }), 'Voix prêtes en anglais. Le français est encore lu par les voix du système. | Ajouter les voix françaises (18 Mo)', 'voices installed before French existed, and a French interface: the call says one small package adds them');
    assert.equal(await c.page.evaluate(async () => { const g = document.querySelector('#empty'), o = document.querySelector('#vOffer'); o.style.display = ''; g.classList.add('on'); const under = getComputedStyle(o).display; g.classList.remove('on'); const after = getComputedStyle(o).display; o.style.display = 'none'; return under + ' ' + after; }), 'none flex', 'a line that offers something is not shown over the empty state: it waits for a call');
    assert.deepEqual(await c.page.evaluate(() => ['Ich habe die Funktion korrigiert und die Tests laufen jetzt alle durch.', '関数を修正し、テストはすべて通りました。', '함수를 수정했고 테스트가 모두 통과합니다.', '我修复了函数，所有测试都通过了。', 'Jeg har rettet funktionen, og alle testene kører nu igennem.', 'I fixed the function and all the tests pass now.'].map(langOf)), ['de', 'ja', 'ko', 'zh', 'da', 'en']);
    assert.deepEqual(await c.page.evaluate(() => { TTS.engine = 'kokoro'; TTS.pool.en = ['af_heart']; TTS.pool.de = ['Anna']; TTS.pool.ja = []; const p = { id: 'main', vi: 0 }; return [babbles(), TTS.voiceFor(p, 'de'), TTS.voiceFor(p, 'ja'), TTS.voiceFor(p, 'en')]; }), [false, 'Anna', 'af_heart', 'af_heart'], 'once the real voices are there: a German line to a German system voice, a language with no voice at all to the English one');
    await c.close();
  });
});
