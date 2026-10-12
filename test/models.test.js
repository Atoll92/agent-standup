// test/models.test.js: the events of a timeline (core/models), the errors, and the contract of a source (core/sources/source.js).
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Event, Say, Report, ToolCall, ToolBeat, Results, UserMessage, Order, Finish, Usage, Compact, AgentCall, AgentDone, WorkflowRun, WorkflowDone } = require('../core/models');
const { SessionNotFound, NotImplemented } = require('../core/errors');
const { Source } = require('../core/sources/source');
const { ClaudeSource } = require('../core/sources/claude');
const { CodexSource } = require('../core/sources/codex');
const { createCore } = require('../core');

const wire = (event) => JSON.parse(JSON.stringify(event));   // what a display receives

test('each event carries its kind and its data on the wire, and nothing else', () => {
  const tool = { id: 'toolu_1', name: 'Bash', arg: 'ls' };
  assert.deepEqual(wire(new Say({ ts: 5, agent: 'main', text: 'hi' })), { ts: 5, agent: 'main', kind: 'say', text: 'hi' });
  assert.deepEqual(wire(new Say({ ts: 5, agent: 'main', text: 'hi', thought: 'hmm' })), { ts: 5, agent: 'main', kind: 'say', text: 'hi', th: 'hmm' });
  assert.deepEqual(wire(new ToolCall({ ts: 5, agent: 'a1', tool })), { ts: 5, agent: 'a1', kind: 'tool', tool });
  assert.deepEqual(wire(new UserMessage({ ts: 5, text: 'go' })), { ts: 5, agent: 'user', kind: 'user', text: 'go' });
  assert.deepEqual(wire(new Results({ ts: 5, agent: 'a1', items: [] })), { ts: 5, agent: 'a1', kind: 'results', items: [] });
  assert.deepEqual(wire(new Compact({ ts: 5, agent: 'main' })), { ts: 5, agent: 'main', kind: 'compact' });
  assert.deepEqual(wire(new AgentCall({ ts: 5, agent: 'main', toolId: 't', bg: false, text: 'x', title: 'y' })), { ts: 5, agent: 'main', kind: 'agentcall', toolId: 't', bg: false, text: 'x', title: 'y' });
  assert.deepEqual(wire(new AgentDone({ ts: 5, agent: 'main', toolId: 't' })), { ts: 5, agent: 'main', kind: 'agentdone', toolId: 't' });
  assert.deepEqual(wire(new WorkflowRun({ ts: 5, agent: 'main', toolId: 't', run: 'r1' })), { ts: 5, agent: 'main', kind: 'wfrun', toolId: 't', run: 'r1' });
  assert.deepEqual(wire(new WorkflowDone({ agent: 'wf:r1', child: 'a1' })), { ts: 0, agent: 'wf:r1', kind: 'wfdone', child: 'a1' });
  assert.deepEqual(wire(new Finish({ ts: 5, agent: 'a1', to: 'main', key: 'f/a1' })), { ts: 5, agent: 'a1', kind: 'finish', to: 'main', k: 'f/a1' });
  assert.deepEqual(wire(new Usage({ ts: 5, agent: 'main', u: { i: 1, o: 2, r: 3, w: 4 }, model: 'm', key: 'u/main/1' })), { ts: 5, agent: 'main', kind: 'usage', u: { i: 1, o: 2, r: 3, w: 4 }, model: 'm', k: 'u/main/1' });
  assert.equal(wire(new Usage({ ts: 5, agent: 'main', u: {}, model: 'm', cw: 200000, key: 'k' })).cw, 200000);
  // an order launched by a workflow names it; one launched by a call names the call
  assert.deepEqual(wire(new Order({ ts: 5, agent: 'main', to: 'a1', toolId: 't', bg: true, wf: 'r1', text: 'x', title: 'y', key: 'o/a1' })),
    { ts: 5, agent: 'main', kind: 'order', to: 'a1', toolId: 't', bg: true, wf: 'r1', text: 'x', title: 'y', k: 'o/a1' });
  assert.equal('wf' in wire(new Order({ ts: 5, agent: 'main', to: 'a1', toolId: 't', bg: false, text: 'x', title: 'y', key: 'k' })), false);
});

test('a report is what a sub-agent said last, keeping its key and its thought', () => {
  const say = new Say({ ts: 5, agent: 'a1', text: 'Found it.', thought: 'easy' }); say.k = 'a1:3';
  const report = Report.from(say);
  assert.ok(report instanceof Say && report.kind === 'report');
  assert.deepEqual(wire(report), { ts: 5, agent: 'a1', kind: 'report', text: 'Found it.', th: 'easy', to: null, k: 'a1:3' });
  assert.equal(say.kind, 'say', 'the line it was made from is left as it was');
});

test('a beat groups the calls of one agent until a turn is closed', () => {
  const call = (agent, id, extra) => Object.assign(new ToolCall({ ts: 1, agent, tool: { id, name: 'Read' } }), extra);
  const first = call('a1', 'one', { k: 'a1:0', th: 'because' });
  const beat = ToolBeat.startingWith(first);
  assert.deepEqual(wire(beat), { ts: 1, agent: 'a1', kind: 'tools', tools: [{ id: 'one', name: 'Read' }], th: 'because', k: 'a1:0' }, 'it keeps the key and the thought of its first call');

  assert.equal(beat.accepts(call('a2', 'x')), false, 'another agent starts its own');
  assert.equal(beat.accepts(call('a1', 'two')), true);
  const before = beat.signature();
  beat.add(call('a1', 'two'));
  assert.equal(beat.tools.length, 2);
  assert.notEqual(beat.signature(), before, 'a beat that gained a call is a different event for the feed');

  const closing = call('a1', 'three'); closing.endTurn();
  beat.add(closing);
  assert.ok(beat.endsTurn);
  assert.equal(beat.accepts(call('a1', 'four')), false, 'a beat that closed a turn takes no more calls');
});

test('only usage, finishes and compactions are bookkeeping', () => {
  const bookkeeping = [new Usage({ ts: 1, agent: 'main', u: {}, model: 'm', key: 'k' }), new Finish({ ts: 1, agent: 'a', to: 'main', key: 'k' }), new Compact({ ts: 1, agent: 'main' })];
  const activity = [new Say({ ts: 1, agent: 'main', text: 'x' }), new ToolCall({ ts: 1, agent: 'main', tool: {} }), new UserMessage({ ts: 1, text: 'x' }), new Order({ ts: 1, agent: 'main', to: 'a' }), new Results({ ts: 1, agent: 'main', items: [] })];
  assert.deepEqual(bookkeeping.map((event) => event.bookkeeping), [true, true, true]);
  assert.deepEqual(activity.map((event) => event.bookkeeping), [false, false, false, false, false]);
});

test('a copy with relative time leaves the shared event alone and is still the same kind of event', () => {
  const say = new Say({ ts: 1500, agent: 'main', text: 'x' }); say.k = 'main:0';
  const copy = say.relativeTo(1000);
  assert.ok(copy instanceof Say);
  assert.equal(copy.t, 500);
  assert.equal('t' in say, false, 'the event is shared by every build of a timeline: it must not be touched');
  assert.equal(copy.signature(), say.signature());
  assert.equal(new Say({ ts: 10, agent: 'main', text: 'x' }).relativeTo(1000).t, 0, 'never before time zero');
});

test('what changes between two builds changes the signature, and what does not, does not', () => {
  const say = new Say({ ts: 1, agent: 'main', text: 'x' });
  const open = say.signature();
  say.endTurn();
  assert.notEqual(say.signature(), open, 'a line that closed the turn');
  assert.equal(new Say({ ts: 2, agent: 'main', text: 'something else' }).signature(), open, 'the text of a line never changes, so it is not part of it');
  const order = (title) => new Order({ ts: 1, agent: 'main', to: 'a1', toolId: 't', bg: false, title, key: 'k' }).signature();
  assert.notEqual(order('one'), order('two'));
});

test('a source says by name what it does not implement', () => {
  class Half extends Source { get name() { return 'half'; } }
  const half = new Half();
  assert.equal(half.owns('anything'), false, 'a source owns no project by default');
  for (const method of ['readSession', 'exists', 'mtime', 'stamp', 'inProject', 'recent', 'listSessions', 'boardRows']) {
    assert.throws(() => half[method]('p', 'i', []), (error) => error instanceof NotImplemented && error.message === `Half does not implement ${method}`, method);
  }
  assert.throws(() => new Source().name, NotImplemented);
});

test('Claude Code and Codex are sources, and a session that is not there is a SessionNotFound for both', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-models-')), codexHome = path.join(root, 'codex');
  fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
  const core = createCore({ root: path.join(root, 'projects'), codexHome });
  assert.ok(core.sources.claude instanceof ClaudeSource && core.sources.claude instanceof Source);
  assert.ok(core.sources.codex instanceof CodexSource && core.sources.codex instanceof Source);
  assert.deepEqual([core.sources.claude.name, core.sources.codex.name], ['claude', 'codex']);
  assert.throws(() => core.timeline('-nothing', 'nope'), SessionNotFound);
  assert.throws(() => core.timeline('_codex', '01a00000-0000-7000-8000-000000000000'), SessionNotFound);
  assert.ok(new SessionNotFound() instanceof Error);
  assert.equal(new SessionNotFound().message, 'session not found');
  assert.ok(Event, 'the base class is exported');
});
