// test/live-turns.test.js: the live call in a real browser: the lead at work until its turn really ends, and its word when it does: what it changed, that it waits for you, or the floor back to you.
// The setup shared by the live-*.test.js files (temporary folder, stand-in claude, sessions being written, the call watched) is in live-helpers.js, which must be required before server.js.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { tmp, missing, wait, start, session, open, count, closing, closed, YOURS } = require('./live-helpers.js');

test('live call: the lead at work and at the end of its turn', { skip: missing || false, timeout: 600000 }, async (t) => {
  await start(t);

  await t.test('the lead is at work until the message that closes its turn: while it thinks, after a long command, and no wrap-up in the middle', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s); await c.quiet(500); assert.equal(await c.lead(), 'done');
    s.user('Run the long job'); await c.heard('Run the long job'); await c.quiet(1500); assert.equal(await c.lead(), 'working');   // thinking: nothing written yet
    s.say('Starting the long job now, this is going to take a while because the whole suite runs twice.'); await wait(500); const id = s.tool('Bash', { command: 'sleep 30' }); await wait(28000);   // longer than the old 25 s rule
    assert.equal(await c.lead(), 'working'); s.result(id, 'ok'); await wait(4000); assert.equal(await c.lead(), 'working'); assert.equal(count(await c.lines(), 'To sum up'), 0);
    s.say('The long job is finished.', { end: true }); await c.heard('long job is finished'); await c.until(() => agentState('main', Date.now()).k === 'done', null, 8000); await c.close();
  });

  await t.test('the lead has a word each time its turn ends: what it changed, that it waits for your answer, or the floor back to you; never in the middle, and off with the little lines', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Fix the login'); await wait(1500); s.result(s.tool('Edit', { file_path: '/x/src/login.js', old_string: 'a', new_string: 'b' }), 'ok'); await wait(1500); assert.deepEqual(await closing(c), []);
    s.say('The login is fixed.', { end: true }); await c.heard('login is fixed'); await closed(c, 1); assert.match((await closing(c))[0], /login\.js/); assert.match((await closing(c))[0], YOURS);
    s.user('Thanks'); await wait(1500); s.say('Should I also add a test for it?', { end: true }); await c.heard('also add a test'); await closed(c, 2); assert.match((await closing(c))[1], /^(I’ll wait for your answer|Your call|Tell me what you prefer)\.$/);
    s.user('No need'); await wait(1500); s.say('Fine, I leave it there.', { end: true }); await c.heard('leave it there'); await closed(c, 3); assert.match((await closing(c))[2], /^(That’s my answer|That’s all from me|Nothing more from me)\. /); assert.doesNotMatch((await closing(c))[2], /login\.js/, 'what an earlier turn changed is not said again');
    await c.page.evaluate(() => { prefs.banter = false; }); s.user('Bye'); await wait(1500); s.say('Goodbye.', { end: true }); await c.heard('Goodbye'); await c.quiet(3000); assert.equal((await closing(c)).length, 3); await c.close();
  });

  await t.test('a win in the middle of a turn is voiced too, and is not "your turn": the agents the lead waited for are back; and a first turn is not over because the lead thinks', async () => {
    const s = session(); s.user('hello', Date.now() - 600000); s.say('Ready.', { at: Date.now() - 590000, end: true }); const c = await open(s);
    s.user('Audit the tests'); await wait(1500); const id = s.launch(1, 'Audit the tests', 'Read every test and list the weak ones.', true); s.result(id, 'Async agent launched successfully.'); await wait(500);
    s.say('The audit runs in the background, I will come back with what it finds.', { end: true }); await c.heard('audit runs in the background');   // Claude Code closes the turn here, and opens it again when the agent stops
    s.result(s.tool('Bash', { command: 'npm test' }, { sub: 1 }), 'ok', { sub: 1 }); await c.quiet(1500); assert.equal(await c.lead(), 'waiting'); assert.deepEqual(await closing(c), []);
    s.say('AUDIT: two tests are weak.', { sub: 1 }); await wait(1000); s.notify(id); await closed(c, 1, 30000);
    assert.match((await closing(c))[0], /^(The team is back|All the reports are in|Everyone has reported)\./); assert.doesNotMatch((await closing(c))[0], YOURS);
    s.result(s.tool('Edit', { file_path: '/x/test/auth.test.js', old_string: 'a', new_string: 'b' }), 'ok'); await wait(800); s.say('Both weak tests are fixed.', { end: true }); await c.heard('weak tests are fixed'); await closed(c, 2);
    assert.match((await closing(c))[1], /auth\.test\.js/); assert.match((await closing(c))[1], YOURS); await c.close();
    const q = session(); q.user('Look at the login'); const d = await open(q); await d.heard('Look at the login'); await wait(27000); assert.equal(await d.lead(), 'working', 'before its first line');   // a session that has not closed a turn yet: the lead is at work while it thinks, it is not your turn after 25 s
    q.result(q.tool('Read', { file_path: '/x/src/login.js' }), 'ok'); await wait(800); q.say('I have read it, thinking about the fix.'); await d.heard('thinking about the fix'); await wait(27000);
    assert.equal(await d.lead(), 'working', 'in the middle of its first turn'); assert.deepEqual(await closing(d), []);
    q.say('The fix is in place.', { end: true }); await d.heard('fix is in place'); await closed(d, 1); assert.match((await closing(d))[0], YOURS); await d.close();
  });
});
