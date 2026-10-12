// The format the page (public/index.html) reads: the core's models, in the short names the page has always used.
// This is the only place that knows them. A display with another format (the gadget) gets a serializer of its own.
//
// Every event:  ts (timestamp), agent (agentId), kind, k (key), t (elapsed, in a timeline), th (thought, when there is one),
//               end: 1 (it closed the turn), fr (its text in French, when it is known in advance: the demo)
// And by kind, below: how each kind is written (`write`) and read back (`read`). Reading what was written gives the same event.
const { Agent, Timeline, eventClassFor } = require('../models');
const { UnknownEventKind } = require('../errors');

const KINDS = {
  say: {
    write: (event) => ({ text: event.text }),
    read: (wire) => ({ text: wire.text }),
  },
  report: {
    write: (event) => ({ text: event.text, to: event.recipientId }),
    read: (wire) => ({ text: wire.text, recipientId: wire.to }),
  },
  tools: {
    write: (event) => ({ tools: event.tools }),
    read: (wire) => ({ tools: wire.tools }),
  },
  results: {
    write: (event) => ({ items: event.items.map((item) => ({ id: item.callId, err: item.failed, out: item.output, ...(item.pictures ? { img: item.pictures } : {}) })) }),
    read: (wire) => ({ items: wire.items.map((item) => ({ callId: item.id, failed: item.err, output: item.out, pictures: item.img || 0 })) }),
  },
  user: {
    write: (event) => ({ text: event.text }),
    read: (wire) => ({ text: wire.text }),
  },
  order: {
    write: (event) => ({
      to: event.recipientId,
      ...(event.callId ? { toolId: event.callId } : {}),
      ...(event.background !== undefined ? { bg: event.background } : {}),
      ...(event.workflow ? { wf: event.workflow } : {}),
      text: event.text,
      title: event.title,
    }),
    read: (wire) => ({ recipientId: wire.to, callId: wire.toolId, background: wire.bg, workflow: wire.wf, text: wire.text, title: wire.title }),
  },
  finish: {
    write: (event) => ({ to: event.recipientId }),
    read: (wire) => ({ recipientId: wire.to }),
  },
  usage: {
    write: (event) => ({
      u: { i: event.tokens.input, o: event.tokens.output, r: event.tokens.cacheReads, w: event.tokens.cacheWrites },
      model: event.model,
      ...(event.contextWindow ? { cw: event.contextWindow } : {}),
    }),
    read: (wire) => ({
      tokens: { input: wire.u.i, output: wire.u.o, cacheReads: wire.u.r, cacheWrites: wire.u.w },
      model: wire.model,
      contextWindow: wire.cw,
    }),
  },
  compact: {
    write: () => ({}),
    read: () => ({}),
  },
};

// An event as the page reads it. What a transcript says before a timeline is built (tool calls, agent calls, workflow runs…)
// has no place here: it would be a mistake for it to reach a display.
function serializeEvent(event) {
  const kind = KINDS[event.kind];
  if (!kind) throw new Error(`${event.constructor.name} is not sent to displays`);
  const french = event.translations && event.translations.fr;
  return {
    ts: event.timestamp,
    agent: event.agentId,
    kind: event.kind,
    ...kind.write(event),
    ...(event.thought ? { th: event.thought } : {}),
    ...(french ? { fr: french } : {}),
    ...(event.endsTurn ? { end: 1 } : {}),
    ...(event.key !== undefined ? { k: event.key } : {}),
    ...(event.elapsed !== undefined ? { t: event.elapsed } : {}),
  };
}

// The event that the page's data describes. Throws UnknownEventKind for a kind the page does not receive.
function deserializeEvent(wire) {
  const kind = KINDS[wire.kind];
  if (!kind) throw new UnknownEventKind(wire.kind);
  const EventClass = eventClassFor(wire.kind);
  const event = new EventClass({
    timestamp: wire.ts,
    agentId: wire.agent,
    key: wire.k,
    thought: wire.th,
    translations: wire.fr ? { fr: wire.fr } : undefined,
    ...kind.read(wire),
  });
  if (wire.end) event.endTurn();
  if (wire.t !== undefined) event.elapsed = wire.t;
  return event;
}

// An agent as the page reads it: toolUseId (launchCallId), wf (workflow), mtime (lastActiveAt), own (ownName), roleFr (its role in French).
function serializeAgent(agent) {
  return {
    id: agent.id,
    role: agent.role,
    type: agent.type,
    ...(agent.name ? { name: agent.name } : {}),
    ...(agent.launchCallId !== undefined ? { toolUseId: agent.launchCallId } : {}),
    ...(agent.workflow ? { wf: agent.workflow } : {}),
    ...(agent.phase ? { phase: agent.phase } : {}),
    ...(agent.lastActiveAt ? { mtime: agent.lastActiveAt } : {}),
    ...(agent.ownName ? { own: agent.ownName } : {}),
    ...(agent.translations.fr ? { roleFr: agent.translations.fr } : {}),
  };
}
const deserializeAgent = (wire) => new Agent({
  id: wire.id, role: wire.role, type: wire.type, name: wire.name, ownName: wire.own, launchCallId: wire.toolUseId, workflow: wire.wf, phase: wire.phase, lastActiveAt: wire.mtime,
  translations: wire.roleFr ? { fr: wire.roleFr } : undefined,
});

// A timeline as the page reads it: id (sessionId), proj (project), ep (feedId) and seq (sequence) of the live feed.
function serializeTimeline(timeline) {
  return {
    id: timeline.sessionId,
    proj: timeline.project,
    agents: timeline.agents.map(serializeAgent),
    events: timeline.events.map(serializeEvent),
    durationMs: timeline.durationMs,
    ...(timeline.recentUntil !== undefined ? { recentUntil: timeline.recentUntil } : {}),
    ...(timeline.feedId !== undefined ? { ep: timeline.feedId } : {}),
    ...(timeline.sequence !== undefined ? { seq: timeline.sequence } : {}),
  };
}
const deserializeTimeline = (wire) => new Timeline({
  sessionId: wire.id, project: wire.proj, agents: wire.agents.map(deserializeAgent), events: wire.events.map(deserializeEvent),
  durationMs: wire.durationMs, recentUntil: wire.recentUntil, feedId: wire.ep, sequence: wire.seq,
});

// A row of the board as the page, the command line and the editors read it: proj, id, mtime, tool, ageMs, subActive, subTotal,
// dir (the folder a Codex session was started in), and source only for a session that is not Claude Code's.
const serializeSessionStatus = (status) => ({
  proj: status.project,
  id: status.sessionId,
  title: status.title,
  mtime: status.lastActiveAt,
  state: status.state,
  tool: status.pendingTool,
  ageMs: status.stateAgeMs,
  subActive: status.activeSubAgents,
  subTotal: status.subAgents,
  ...(status.folderKey ? { dir: status.folderKey } : {}),
  ...(status.source !== 'claude' ? { source: status.source } : {}),
});

// A session to pick from, as the page reads it: proj, id, mtime, size, agents (how many sub-agents), project (its label),
// and source only for a session that is not Claude Code's.
const serializeSessionListing = (listing) => ({
  proj: listing.project,
  id: listing.sessionId,
  mtime: listing.lastActiveAt,
  size: listing.sizeBytes,
  agents: listing.subAgents,
  title: listing.title,
  project: listing.projectLabel,
  ...(listing.source !== 'claude' ? { source: listing.source } : {}),
});

// What the page gets when it follows a session live: the session's agents, where the feed is, and the events new or different since it last asked.
const serializeFeed = (timeline, events) => ({ id: timeline.sessionId, agents: timeline.agents.map(serializeAgent), ep: timeline.feedId, seq: timeline.sequence, events: events.map(serializeEvent) });

module.exports = { serializeEvent, deserializeEvent, serializeAgent, deserializeAgent, serializeTimeline, deserializeTimeline, serializeFeed, serializeSessionStatus, serializeSessionListing };
