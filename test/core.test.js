// test/core.test.js: the core on its own (no server): what a session's files become, what the board says about each session, the live feed, the session to follow.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-core-'));
process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects');   // before the core is loaded: it reads this once
const core = require('../core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

// ---- transcripts, written the way Claude Code writes them
const rec = {
  user: (text, at) => ({ type: 'user', timestamp: at, message: { content: text } }),
  say: (text, at, extra = {}) => ({ type: 'assistant', timestamp: at, message: { id: 'm' + at, content: [{ type: 'text', text }], ...extra } }),
  call: (id, name, input, at) => ({ type: 'assistant', timestamp: at, message: { id: 'm' + id, content: [{ type: 'tool_use', id, name, input }] } }),
  result: (id, out, at) => ({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }),
};
const write = (file, records) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const append = (file, records) => fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const projectDir = (name) => path.join(tmp, 'projects', name);
const setAge = (file, seconds) => { const t = new Date(Date.now() - seconds * 1000); fs.utimesSync(file, t, t); };

test('a lead and its sub-agent become one timeline: order, work, report, finish, in time order', () => {
  const dir = projectDir('-tl'), main = path.join(dir, 's.jsonl'), sub = path.join(dir, 's', 'subagents', 'agent-a1.jsonl');
  write(main, [
    rec.user('fix the login', ago(60)),
    rec.say('On it.', ago(58)),
    rec.call('toolu_agent', 'Agent', { prompt: 'look at login.js', description: 'Look at login' }, ago(56)),
    rec.result('toolu_agent', 'Found it.', ago(40)),   // a synchronous call coming back: the sub-agent is done
    rec.say('Done.', ago(38), { stop_reason: 'end_turn' }),
  ]);
  write(sub, [
    rec.user('look at login.js', ago(55)),
    rec.call('toolu_read', 'Read', { file_path: '/p/login.js' }, ago(54)),
    rec.result('toolu_read', 'line 1', ago(53)),
    rec.say('Found it.', ago(42)),
  ]);
  fs.writeFileSync(sub.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ description: 'Look at login', agentType: 'general-purpose', toolUseId: 'toolu_agent' }));

  const tl = core.timeline('-tl', 's');
  assert.deepEqual(tl.agents.map((a) => [a.id, a.role]), [['main', 'Lead'], ['a1', 'Look at login']]);
  const story = tl.events.filter((e) => e.kind !== 'usage').map((e) => e.kind + ':' + e.agent + (e.to ? '>' + e.to : ''));
  assert.deepEqual(story, ['user:user', 'say:main', 'order:main>a1', 'tools:a1', 'results:a1', 'report:a1>main', 'finish:a1>main', 'say:main']);
  assert.equal(tl.events.at(-1).end, 1, 'the lead\'s last line closes its turn');
  assert.equal(tl.events.find((e) => e.kind === 'tools').tools[0].d.kind, 'read');
  assert.equal(tl.events[0].t, 0, 'time zero is the first thing said');
  assert.ok(tl.events.every((e, i) => i === 0 || e.ts >= tl.events[i - 1].ts), 'events are sorted by time');
});

test('consecutive tool calls of one agent are one beat; a line in between starts a new one', () => {
  const file = path.join(projectDir('-beats'), 's.jsonl');
  write(file, [
    rec.call('t1', 'Grep', { pattern: 'a' }, ago(30)), rec.call('t2', 'Read', { file_path: '/x' }, ago(29)),
    rec.say('Looking.', ago(28)),
    rec.call('t3', 'Bash', { command: 'ls' }, ago(27)),
  ]);
  const beats = core.timeline('-beats', 's').events.filter((e) => e.kind === 'tools');
  assert.deepEqual(beats.map((b) => b.tools.map((t) => t.name)), [['Grep', 'Read'], ['Bash']]);
});

test('the board tells working, waiting, blocked, turn and idle from the tail of each transcript', () => {
  const sessions = {
    working: [rec.call('t', 'Bash', { command: 'npm test' }, ago(20))],
    editJustNow: [rec.call('t', 'Edit', { file_path: '/x', old_string: 'a', new_string: 'b' }, ago(5))],   // too soon to say it waits for permission
    editWaiting: [rec.call('t', 'Edit', { file_path: '/x', old_string: 'a', new_string: 'b' }, ago(20))],
    question: [rec.call('t', 'AskUserQuestion', { questions: [{ question: 'Which one?' }] }, ago(10))],
    subAgent: [rec.call('t', 'Agent', { prompt: 'p', description: 'd' }, ago(20))],
    turn: [rec.user('hi', ago(20)), rec.say('Here you go.', ago(10), { stop_reason: 'end_turn' })],
  };
  for (const [name, records] of Object.entries(sessions)) write(path.join(projectDir('-board-' + name), 's.jsonl'), records);
  write(path.join(projectDir('-board-idle'), 's.jsonl'), [rec.say('Old.', ago(7200))]); setAge(path.join(projectDir('-board-idle'), 's.jsonl'), 3600);

  const rows = Object.fromEntries(core.boardRows().filter((r) => r.proj.startsWith('-board-')).map((r) => [r.proj.slice('-board-'.length), r]));
  assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.state])),
    { working: 'working', editJustNow: 'working', editWaiting: 'blocked', question: 'blocked', subAgent: 'waiting', turn: 'turn', idle: 'idle' });
  assert.equal(rows.working.tool, 'Bash');
  assert.equal(rows.turn.title, 'hi', 'a session with no title is named by what the person first typed');
});

test('the live feed gives only what is new, under the same memory', async () => {
  const file = path.join(projectDir('-feed'), 's.jsonl');
  write(file, [rec.user('start', ago(30)), rec.say('One.', ago(29))]);
  const first = core.timelineEntry('-feed', 's'), seen = first.tl.seq;
  assert.equal(core.feedSince(first, 0).length, first.tl.events.length, 'a reader that has nothing gets everything');
  assert.equal(core.feedSince(first, seen).length, 0, 'a reader that is up to date gets nothing');

  await sleep(300);   // a session is not rebuilt more than every 250 ms
  append(file, [rec.say('Two.', ago(1))]);
  const next = core.timelineEntry('-feed', 's');
  assert.equal(next.tl.ep, first.tl.ep, 'same memory: the reader keeps what it has');
  assert.ok(next.tl.seq > seen);
  assert.deepEqual(core.feedSince(next, seen).map((e) => e.text), ['Two.']);
});

test('the session to follow: the newest, kept while it is active, or the one pinned', () => {
  const older = path.join(projectDir('-follow-a'), 's.jsonl'), newer = path.join(projectDir('-follow-b'), 's.jsonl');
  write(older, [rec.say('a', ago(100))]); write(newer, [rec.say('b', ago(100))]);
  setAge(older, 60); setAge(newer, -5);   // newer than every other session of this file, whatever the order they were written in
  const pick = (...args) => core.currentSession(...args).proj;

  // A project asked for by name matches that folder and the folders inside it, whose names start with the same name and a dash.
  assert.equal(pick('-follow', '', null), '-follow-b', 'the most recently written of the project');
  assert.equal(pick('-follow', '', { proj: '-follow-a', id: 's' }), '-follow-a', 'the one followed stays while it was written to in the last 90 s');
  setAge(older, 200);
  assert.equal(pick('-follow', '', { proj: '-follow-a', id: 's' }), '-follow-b', 'but not once it has been quiet for longer');
  assert.equal(pick('-follow-a', 's', null), '-follow-a', 'pinned by project and session');
  assert.equal(pick('-follow-nothing', '', null), pick('', '', null), 'a project with no session falls back to the newest anywhere');
  assert.deepEqual(core.currentSession('..', '..', { proj: '..', id: '..' }), core.currentSession('', '', null), 'names that climb out of the folder are not followed');
});
