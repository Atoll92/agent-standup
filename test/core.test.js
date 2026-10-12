// test/core.test.js: the core on its own (no server): what a session's files become, what the board says about each session, the live feed, the session to follow.
// Each test makes its own core over its own folder, so nothing is shared between them.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { createCore } = require('../core');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-core-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

// A core over a new, empty folder of sessions. `dir(project)` is where a project's transcripts go.
let folders = 0;
function newCore() {
  const root = path.join(tmp, 'projects' + ++folders);
  return { core: createCore({ root }), dir: (project) => path.join(root, project) };
}

// ---- transcripts, written the way Claude Code writes them
const rec = {
  user: (text, at) => ({ type: 'user', timestamp: at, message: { content: text } }),
  say: (text, at, extra = {}) => ({ type: 'assistant', timestamp: at, message: { id: 'm' + at, content: [{ type: 'text', text }], ...extra } }),
  call: (id, name, input, at) => ({ type: 'assistant', timestamp: at, message: { id: 'm' + id, content: [{ type: 'tool_use', id, name, input }] } }),
  result: (id, out, at) => ({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }),
};
const write = (file, records) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const append = (file, records) => fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const setAge = (file, seconds) => { const t = new Date(Date.now() - seconds * 1000); fs.utimesSync(file, t, t); };

test('a lead and its sub-agent become one timeline: order, work, report, finish, in time order', () => {
  const { core, dir } = newCore(), main = path.join(dir('-tl'), 's.jsonl'), sub = path.join(dir('-tl'), 's', 'subagents', 'agent-a1.jsonl');
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
  const story = tl.events.filter((event) => event.kind !== 'usage').map((event) => event.kind + ':' + event.agentId + (event.recipientId ? '>' + event.recipientId : ''));
  assert.deepEqual(story, ['user:user', 'say:main', 'order:main>a1', 'tools:a1', 'results:a1', 'report:a1>main', 'finish:a1>main', 'say:main']);
  assert.equal(tl.events.at(-1).endsTurn, true, 'the lead\'s last line closes its turn');
  assert.equal(tl.events.find((e) => e.kind === 'tools').tools[0].d.kind, 'read');
  assert.equal(tl.events[0].elapsed, 0, 'time zero is the first thing said');
  assert.ok(tl.events.every((event, i) => i === 0 || event.timestamp >= tl.events[i - 1].timestamp), 'events are sorted by time');
});

test('consecutive tool calls of one agent are one beat; a line in between starts a new one', () => {
  const { core, dir } = newCore();
  write(path.join(dir('-beats'), 's.jsonl'), [
    rec.call('t1', 'Grep', { pattern: 'a' }, ago(30)), rec.call('t2', 'Read', { file_path: '/x' }, ago(29)),
    rec.say('Looking.', ago(28)),
    rec.call('t3', 'Bash', { command: 'ls' }, ago(27)),
  ]);
  const beats = core.timeline('-beats', 's').events.filter((e) => e.kind === 'tools');
  assert.deepEqual(beats.map((b) => b.tools.map((t) => t.name)), [['Grep', 'Read'], ['Bash']]);
});

test('the board tells working, waiting, blocked, turn and idle from the tail of each transcript', () => {
  const { core, dir } = newCore();
  const sessions = {
    working: [rec.call('t', 'Bash', { command: 'npm test' }, ago(20))],
    editJustNow: [rec.call('t', 'Edit', { file_path: '/x', old_string: 'a', new_string: 'b' }, ago(5))],   // too soon to say it waits for permission
    editWaiting: [rec.call('t', 'Edit', { file_path: '/x', old_string: 'a', new_string: 'b' }, ago(20))],
    question: [rec.call('t', 'AskUserQuestion', { questions: [{ question: 'Which one?' }] }, ago(10))],
    subAgent: [rec.call('t', 'Agent', { prompt: 'p', description: 'd' }, ago(20))],
    turn: [rec.user('hi', ago(20)), rec.say('Here you go.', ago(10), { stop_reason: 'end_turn' })],
  };
  for (const [name, records] of Object.entries(sessions)) write(path.join(dir(name), 's.jsonl'), records);
  write(path.join(dir('idle'), 's.jsonl'), [rec.say('Old.', ago(7200))]); setAge(path.join(dir('idle'), 's.jsonl'), 3600);

  const rows = Object.fromEntries(core.boardRows().map((r) => [r.proj, r]));
  assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.state])),
    { working: 'working', editJustNow: 'working', editWaiting: 'blocked', question: 'blocked', subAgent: 'waiting', turn: 'turn', idle: 'idle' });
  assert.equal(rows.working.tool, 'Bash');
  assert.equal(rows.turn.title, 'hi', 'a session with no title is named by what the person first typed');
});

test('the live feed gives only what is new, under the same memory', async () => {
  const { core, dir } = newCore(), file = path.join(dir('-feed'), 's.jsonl');
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
  const { core, dir } = newCore(), older = path.join(dir('-follow-a'), 's.jsonl'), newer = path.join(dir('-follow-b'), 's.jsonl');
  write(older, [rec.say('a', ago(100))]); write(newer, [rec.say('b', ago(100))]);
  setAge(older, 60); setAge(newer, 30);
  const pick = (...args) => core.currentSession(...args).proj;

  assert.equal(pick('', '', null), '-follow-b', 'the most recently written');
  // A project asked for by name matches that folder and the folders inside it, whose names start with the same name and a dash.
  assert.equal(pick('-follow', '', null), '-follow-b');
  assert.equal(pick('-follow', '', { proj: '-follow-a', id: 's' }), '-follow-a', 'the one followed stays while it was written to in the last 90 s');
  setAge(older, 200);
  assert.equal(pick('-follow', '', { proj: '-follow-a', id: 's' }), '-follow-b', 'but not once it has been quiet for longer');
  assert.equal(pick('-follow-a', 's', null), '-follow-a', 'pinned by project and session');
  assert.equal(pick('-follow-nothing', '', null), '-follow-b', 'a project with no session falls back to the newest anywhere');
  assert.deepEqual(core.currentSession('..', '..', { proj: '..', id: '..' }), core.currentSession('', '', null), 'names that climb out of the folder are not followed');
  assert.deepEqual(newCore().core.currentSession('', '', null), {}, 'no session at all: nothing to follow');
});

test('two cores over two folders do not share anything, and a core needs its folder', () => {
  const one = newCore(), two = newCore();
  write(path.join(one.dir('-only-one'), 's.jsonl'), [rec.say('hi', ago(5))]);
  write(path.join(two.dir('-only-two'), 's.jsonl'), [rec.say('hi', ago(5))]);
  assert.deepEqual(one.core.boardRows().map((r) => r.proj), ['-only-one']);
  assert.deepEqual(two.core.boardRows().map((r) => r.proj), ['-only-two']);
  assert.throws(() => one.core.timeline('-only-two', 's'), /session not found/);
  assert.equal(one.core.sources.codex.home, null, 'Codex is left out unless a folder is given');
  assert.throws(() => createCore({}), /root/);
});

test('every source gives the whole interface', () => {
  const { core } = newCore();
  for (const [name, source] of Object.entries(core.sources)) {
    for (const method of ['readSession', 'exists', 'mtime', 'stamp', 'inProject', 'recent', 'listSessions', 'boardRows']) assert.equal(typeof source[method], 'function', name + '.' + method);
  }
});

test('the timeline, the board and the session to follow work through the interface only: a made-up source is a source like any other', () => {
  const { createTimeline } = require('../core/timeline'), { createBoard } = require('../core/board'), { createCurrent } = require('../core/current');
  const { Say } = require('../core/models');
  const at = Date.now() - 5000;
  const fake = {
    name: 'fake', owns: (proj) => proj === '_fake',
    readSession: (proj, id, touched) => {
      if (id !== 'one') throw new Error('session not found');
      touched.push('/fake/one');
      const say = new Say({ timestamp: at, agentId: 'main', text: 'Hello from nowhere.', key: 'main:0' });
      return { agents: { main: { id: 'main', role: 'Lead', type: 'main', name: 'Fake' } }, states: [{ agent: 'main', raw: [say], msgUsage: new Map(), lastTs: at }], runs: {} };
    },
    exists: (proj, id) => id === 'one', mtime: (proj, id) => (id === 'one' ? at : 0), stamp: () => 1, inProject: (proj, id, folder) => folder === '_fake',
    recent: () => [{ proj: '_fake', id: 'one', mtime: at }],
    listSessions: () => [{ proj: '_fake', id: 'one', mtime: at, title: 'One' }],
    boardRows: () => [{ proj: '_fake', id: 'one', mtime: at, state: 'working' }],
  };
  const sourceOf = () => fake, read = [];

  const tl = createTimeline({ sourceOf }).buildTimeline('_fake', 'one', read);
  assert.deepEqual(tl.events.map((e) => e.kind + ':' + e.text), ['say:Hello from nowhere.']);
  assert.deepEqual(read, ['/fake/one']);
  assert.throws(() => createTimeline({ sourceOf }).buildTimeline('_fake', 'two', []), /session not found/);

  assert.deepEqual(createBoard({ sources: [fake] }).boardRows().map((r) => r.state), ['working']);
  assert.deepEqual(createBoard({ sources: [fake] }).listSessions().map((r) => r.title), ['One']);
  const current = createCurrent({ sources: [fake], sourceOf });
  assert.deepEqual(current.currentSession('', '', null), { proj: '_fake', id: 'one', mtime: at });
  assert.ok(current.currentSession('_fake', 'one', null).mtime > at + 1000, 'pinned: it is named, whatever it did last');
  assert.deepEqual(current.currentSession('_fake', 'two', null), { proj: '_fake', id: 'one', mtime: at }, 'a session that is not there is not pinned');
});
