// test/serializers.test.js: the format the page reads (core/serializers/web.js). It must not change: public/index.html reads these names.
const test = require('node:test'), assert = require('node:assert');
const { Say, Report, ToolBeat, ToolCall, Results, UserMessage, Order, Finish, Usage, Compact, AgentCall, AgentDone, WorkflowRun, WorkflowDone } = require('../core/models');
const { serializeEvent, deserializeEvent, serializeAgent, deserializeAgent, serializeTimeline, deserializeTimeline, serializeFeed } = require('../core/serializers/web');
const { Event, Agent, Timeline } = require('../core/models');
const { UnknownEventKind } = require('../core/errors');
const { demoTimeline } = require('../core/demo');

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
    assert.throws(() => serializeEvent(signal), /is not sent to displays/, signal.constructor.name);
  }
});

test('a timeline in the names the page reads, with its live feed, and read back the same', () => {
  const timeline = new Timeline({ sessionId: 's', project: '-p', agents: [Agent.lead()], events: [new Say({ timestamp: 5, agentId: 'main', text: 'hi', key: 'main:0' }).relativeTo(5)], durationMs: 0, recentUntil: 0, feedId: 'e', sequence: 1 });
  const wire = { id: 's', proj: '-p', agents: [{ id: 'main', role: 'Lead', type: 'main' }], events: [{ ts: 5, agent: 'main', kind: 'say', text: 'hi', k: 'main:0', t: 0 }], durationMs: 0, recentUntil: 0, ep: 'e', seq: 1 };
  assert.deepEqual(serializeTimeline(timeline), wire);
  const back = deserializeTimeline(wire);
  assert.ok(back instanceof Timeline && back.lead instanceof Agent);
  assert.deepEqual(serializeTimeline(back), wire);
  assert.deepEqual(serializeFeed(timeline, timeline.events), { id: 's', agents: wire.agents, ep: 'e', seq: 1, events: wire.events }, 'what a page following the session live gets');
});

test('reading back what the page receives gives the same event, of the same class', () => {
  const tool = { id: 'toolu_1', name: 'Bash', arg: 'ls' };
  const closing = new Say({ timestamp: 5, agentId: 'main', text: 'Done.', thought: 'phew', translations: { fr: 'Fini.' }, key: 'main:9' }); closing.endTurn();
  const report = Report.from(new Say({ timestamp: 5, agentId: 'a1', text: 'ok', key: 'a1:2' })); report.recipientId = 'main';
  const events = [
    closing.relativeTo(1),
    report,
    ToolBeat.startingWith(new ToolCall({ timestamp: 5, agentId: 'a1', tool, thought: 'look', key: 'a1:0' })),
    new Results({ timestamp: 5, agentId: 'a1', key: 'a1:1', items: [{ callId: 't1', failed: true, output: 'no', pictures: 2 }] }),
    new UserMessage({ timestamp: 5, text: 'go', translations: { fr: 'vas-y' }, key: 'user:1' }),
    new Order({ timestamp: 5, agentId: 'main', recipientId: 'a2', background: true, workflow: 'run1', text: 'x', title: 'Phase', key: 'o/a2' }),
    new Finish({ timestamp: 5, agentId: 'a1', recipientId: 'main', key: 'f/a1' }),
    new Usage({ timestamp: 5, agentId: 'main', tokens: { input: 1, output: 2, cacheReads: 3, cacheWrites: 4 }, model: 'm', contextWindow: 200000, key: 'u' }),
    new Compact({ timestamp: 5, agentId: 'main', key: 'main:4' }),
  ];
  for (const event of events) {
    const back = deserializeEvent(serializeEvent(event));
    assert.equal(back.constructor, event.constructor, event.kind);
    assert.deepEqual(serializeEvent(back), serializeEvent(event), event.kind);
  }
  assert.deepEqual([deserializeEvent(serializeEvent(closing)).translations, deserializeEvent(serializeEvent(closing)).endsTurn], [{ fr: 'Fini.' }, true]);
});

test('data of a kind the page does not receive is refused by name', () => {
  for (const kind of ['nope', 'tool', 'agentcall', 'wfrun']) assert.throws(() => deserializeEvent({ ts: 1, agent: 'main', kind }), (error) => error instanceof UnknownEventKind && error.kind === kind, kind);
});

test('the demo is models like a real session, and the page receives it as it was written', () => {
  const written = require('../demo.js')();
  const demo = demoTimeline();
  assert.ok(demo.events.every((event) => event instanceof Event), 'models');
  assert.ok(demo instanceof Timeline);
  assert.deepEqual([demo.feedId, demo.sequence, demo.events[0].key, demo.events.length], ['demo', 1, 'd:0', written.events.length]);
  const french = demo.events.find((event) => event.kind === 'say');
  assert.ok(french.translations.fr, 'its lines keep their French');
  // as the page receives it: what demo.js wrote, each line with its key
  const sent = serializeTimeline(deserializeTimeline({ ...written, events: written.events.map((event, index) => ({ ...event, k: 'd:' + index })) }));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.events)), written.events.map((event, index) => ({ ...event, k: 'd:' + index })));
});

test('agents in the names the page reads, and read back the same', () => {
  assert.deepEqual(serializeAgent(Agent.lead()), { id: 'main', role: 'Lead', type: 'main' });
  assert.deepEqual(serializeAgent(Agent.lead({ name: 'Codex' })), { id: 'main', role: 'Lead', type: 'main', name: 'Codex' });
  const subAgent = new Agent({ id: 'a1', role: 'Look at login', type: 'general-purpose', launchCallId: 'toolu_1', workflow: 'run1', phase: 'review', lastActiveAt: 1234, translations: { fr: 'Regarder le login' } });
  const wire = { id: 'a1', role: 'Look at login', type: 'general-purpose', toolUseId: 'toolu_1', wf: 'run1', phase: 'review', mtime: 1234, roleFr: 'Regarder le login' };
  assert.deepEqual(serializeAgent(subAgent), wire);
  const back = deserializeAgent(wire);
  assert.ok(back instanceof Agent);
  assert.deepEqual(serializeAgent(back), wire);
});
