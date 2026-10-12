// test/models.test.js: the events of a timeline (core/models), the errors, and the contract of a source (core/sources/source.js). What the page receives is in serializers.test.js.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Event, Say, Report, ToolCall, ToolBeat, Results, UserMessage, Order, Finish, Usage, Compact, AgentCall, AgentDone, WorkflowRun, WorkflowDone } = require('../core/models');
const { SessionNotFound, NotImplemented } = require('../core/errors');
const { Source } = require('../core/sources/source');
const { ClaudeSource } = require('../core/sources/claude');
const { CodexSource } = require('../core/sources/codex');
const { createCore } = require('../core');

test('an event says what it is with readable attributes', () => {
  const say = new Say({ timestamp: 5, agentId: 'main', text: 'hi', thought: 'hmm', key: 'main:0' });
  assert.deepEqual({ ...say }, { timestamp: 5, agentId: 'main', kind: 'say', key: 'main:0', endsTurn: false, text: 'hi', thought: 'hmm' });
  assert.equal(new Say({ timestamp: 5, agentId: 'main', text: 'hi' }).thought, '', 'no thought: an empty one');
  assert.equal(new UserMessage({ timestamp: 5, text: 'go' }).agentId, 'user');
  const order = new Order({ timestamp: 5, agentId: 'main', recipientId: 'a1', callId: 't', background: true, workflow: 'r1', text: 'x', title: 'y', key: 'o/a1' });
  assert.deepEqual([order.recipientId, order.callId, order.background, order.workflow], ['a1', 't', true, 'r1']);
  const usage = new Usage({ timestamp: 5, agentId: 'main', tokens: { input: 1, output: 2, cacheReads: 3, cacheWrites: 4 }, model: 'm', contextWindow: 200000, key: 'k' });
  assert.deepEqual([usage.tokens.cacheReads, usage.contextWindow], [3, 200000]);
  assert.equal(new WorkflowDone({ agentId: 'wf:r1', childId: 'a1' }).timestamp, 0, 'a journal has no times');
  for (const event of [new ToolCall({ timestamp: 1, agentId: 'a', tool: {} }), new Results({ timestamp: 1, agentId: 'a', items: [] }), new Compact({ timestamp: 1, agentId: 'a' }),
    new AgentCall({ timestamp: 1, agentId: 'a', callId: 't' }), new AgentDone({ timestamp: 1, agentId: 'a', callId: 't' }), new WorkflowRun({ timestamp: 1, agentId: 'a', callId: 't', run: 'r' }), new Finish({ timestamp: 1, agentId: 'a', recipientId: 'main', key: 'k' })]) {
    assert.equal(event.kind, event.constructor.kind);
    assert.equal(event.endsTurn, false);
  }
});

test('a report is what a sub-agent said last, keeping its key and its thought', () => {
  const say = new Say({ timestamp: 5, agentId: 'a1', text: 'Found it.', thought: 'easy', key: 'a1:3' });
  const report = Report.from(say);
  assert.ok(report instanceof Say && report.kind === 'report');
  assert.deepEqual([report.text, report.thought, report.key, report.recipientId], ['Found it.', 'easy', 'a1:3', null]);
  assert.equal(say.kind, 'say', 'the line it was made from is left as it was');
});

test('a beat groups the calls of one agent until a turn is closed', () => {
  const call = (agentId, id, extra) => new ToolCall({ timestamp: 1, agentId, tool: { id, name: 'Read' }, ...extra });
  const beat = ToolBeat.startingWith(call('a1', 'one', { key: 'a1:0', thought: 'because' }));
  assert.deepEqual([beat.tools, beat.thought, beat.key], [[{ id: 'one', name: 'Read' }], 'because', 'a1:0'], 'it keeps the key and the thought of its first call');

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
  const bookkeeping = [new Usage({ timestamp: 1, agentId: 'main', tokens: {}, model: 'm', key: 'k' }), new Finish({ timestamp: 1, agentId: 'a', recipientId: 'main', key: 'k' }), new Compact({ timestamp: 1, agentId: 'main' })];
  const activity = [new Say({ timestamp: 1, agentId: 'main', text: 'x' }), new ToolCall({ timestamp: 1, agentId: 'main', tool: {} }), new UserMessage({ timestamp: 1, text: 'x' }), new Order({ timestamp: 1, agentId: 'main', recipientId: 'a' }), new Results({ timestamp: 1, agentId: 'main', items: [] })];
  assert.deepEqual(bookkeeping.map((event) => event.bookkeeping), [true, true, true]);
  assert.deepEqual(activity.map((event) => event.bookkeeping), [false, false, false, false, false]);
});

test('a copy with relative time leaves the shared event alone and is still the same kind of event', () => {
  const say = new Say({ timestamp: 1500, agentId: 'main', text: 'x', key: 'main:0' });
  const copy = say.relativeTo(1000);
  assert.ok(copy instanceof Say);
  assert.equal(copy.elapsed, 500);
  assert.equal('elapsed' in say, false, 'the event is shared by every build of a timeline: it must not be touched');
  assert.equal(copy.signature(), say.signature());
  assert.equal(new Say({ timestamp: 10, agentId: 'main', text: 'x' }).relativeTo(1000).elapsed, 0, 'never before time zero');
});

test('what changes between two builds changes the signature, and what does not, does not', () => {
  const say = new Say({ timestamp: 1, agentId: 'main', text: 'x' });
  const open = say.signature();
  say.endTurn();
  assert.notEqual(say.signature(), open, 'a line that closed the turn');
  assert.equal(new Say({ timestamp: 2, agentId: 'main', text: 'something else' }).signature(), open, 'the text of a line never changes, so it is not part of it');
  const order = (title) => new Order({ timestamp: 1, agentId: 'main', recipientId: 'a1', callId: 't', background: false, title, key: 'k' }).signature();
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
