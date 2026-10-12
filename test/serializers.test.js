// test/serializers.test.js: the format the page reads (core/serializers/web.js). It must not change: public/index.html reads these names.
const test = require('node:test'), assert = require('node:assert');
const { Say, Report, ToolBeat, ToolCall, Results, UserMessage, Order, Finish, Usage, Compact, AgentCall, AgentDone, WorkflowRun, WorkflowDone } = require('../core/models');
const { serializeEvent, serializeTimeline } = require('../core/serializers/web');

test('each event in the short names the page reads, and nothing else', () => {
  const tool = { id: 'toolu_1', name: 'Bash', arg: 'ls' };
  const say = new Say({ timestamp: 5, agentId: 'main', text: 'hi', key: 'main:0' });
  assert.deepEqual(serializeEvent(say), { ts: 5, agent: 'main', kind: 'say', text: 'hi', k: 'main:0' });
  say.endTurn();
  assert.deepEqual(serializeEvent(new Say({ timestamp: 5, agentId: 'main', text: 'hi', thought: 'hmm', key: 'k' })), { ts: 5, agent: 'main', kind: 'say', text: 'hi', th: 'hmm', k: 'k' });
  assert.equal(serializeEvent(say).end, 1, 'a line that closed the turn');
  assert.deepEqual(serializeEvent(say.relativeTo(2)), { ts: 5, agent: 'main', kind: 'say', text: 'hi', end: 1, k: 'main:0', t: 3 }, 'in a timeline, with its time since time zero');

  const report = Report.from(new Say({ timestamp: 5, agentId: 'a1', text: 'done', key: 'a1:2' })); report.recipientId = 'main';
  assert.deepEqual(serializeEvent(report), { ts: 5, agent: 'a1', kind: 'report', text: 'done', to: 'main', k: 'a1:2' });
  assert.deepEqual(serializeEvent(ToolBeat.startingWith(new ToolCall({ timestamp: 5, agentId: 'a1', tool, key: 'a1:0' }))), { ts: 5, agent: 'a1', kind: 'tools', tools: [tool], k: 'a1:0' });
  assert.deepEqual(serializeEvent(new UserMessage({ timestamp: 5, text: 'go', key: 'user:1' })), { ts: 5, agent: 'user', kind: 'user', text: 'go', k: 'user:1' });
  assert.deepEqual(serializeEvent(new Compact({ timestamp: 5, agentId: 'main', key: 'main:9' })), { ts: 5, agent: 'main', kind: 'compact', k: 'main:9' });
  assert.deepEqual(serializeEvent(new Finish({ timestamp: 5, agentId: 'a1', recipientId: 'main', key: 'f/a1' })), { ts: 5, agent: 'a1', kind: 'finish', to: 'main', k: 'f/a1' });
});

test('results: the call, whether it failed, the output, and the pictures only when there are some', () => {
  const results = new Results({ timestamp: 5, agentId: 'a1', key: 'a1:1', items: [{ callId: 't1', failed: false, output: 'ok', pictures: 0 }, { callId: 't2', failed: true, output: 'no', pictures: 2 }] });
  assert.deepEqual(serializeEvent(results), { ts: 5, agent: 'a1', kind: 'results', items: [{ id: 't1', err: false, out: 'ok' }, { id: 't2', err: true, out: 'no', img: 2 }], k: 'a1:1' });
});

test('orders: the call that launched them, and the workflow only for a workflow', () => {
  const byCall = new Order({ timestamp: 5, agentId: 'main', recipientId: 'a1', callId: 'toolu_9', background: false, text: 'look', title: 'Look', key: 'main:3' });
  assert.deepEqual(serializeEvent(byCall), { ts: 5, agent: 'main', kind: 'order', to: 'a1', toolId: 'toolu_9', bg: false, text: 'look', title: 'Look', k: 'main:3' });
  const byWorkflow = new Order({ timestamp: 5, agentId: 'main', recipientId: 'a2', background: true, workflow: 'run1', text: 'x', title: 'Phase', key: 'o/a2' });
  assert.deepEqual(serializeEvent(byWorkflow), { ts: 5, agent: 'main', kind: 'order', to: 'a2', bg: true, wf: 'run1', text: 'x', title: 'Phase', k: 'o/a2' });
});

test('usage: the four counts as u, and the context window only when it is known', () => {
  const tokens = { input: 1, output: 2, cacheReads: 3, cacheWrites: 4 };
  assert.deepEqual(serializeEvent(new Usage({ timestamp: 5, agentId: 'main', tokens, model: 'm', key: 'u/main/x' })), { ts: 5, agent: 'main', kind: 'usage', u: { i: 1, o: 2, r: 3, w: 4 }, model: 'm', k: 'u/main/x' });
  assert.equal(serializeEvent(new Usage({ timestamp: 5, agentId: 'main', tokens, model: 'm', contextWindow: 200000, key: 'k' })).cw, 200000);
});

test('what a transcript says before the timeline is built never reaches a display', () => {
  for (const signal of [new ToolCall({ timestamp: 1, agentId: 'a', tool: {} }), new AgentCall({ timestamp: 1, agentId: 'a', callId: 't' }), new AgentDone({ timestamp: 1, agentId: 'a', callId: 't' }),
    new WorkflowRun({ timestamp: 1, agentId: 'a', callId: 't', run: 'r' }), new WorkflowDone({ agentId: 'a', childId: 'c' })]) {
    assert.throws(() => serializeEvent(signal), /are not sent to displays/, signal.constructor.name);
  }
});

test('a timeline keeps what it is and has its events serialized', () => {
  const timeline = { id: 's', proj: '-p', agents: [{ id: 'main', role: 'Lead' }], events: [new Say({ timestamp: 5, agentId: 'main', text: 'hi', key: 'main:0' }).relativeTo(5)], durationMs: 0, recentUntil: 0, ep: 'e', seq: 1 };
  assert.deepEqual(serializeTimeline(timeline), { ...timeline, events: [{ ts: 5, agent: 'main', kind: 'say', text: 'hi', k: 'main:0', t: 0 }] });
});
