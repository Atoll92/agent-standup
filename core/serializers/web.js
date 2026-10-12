// The format the page (public/index.html) reads: the core's models, in the short names the page has always used.
// This is the only place that knows them. A display with another format (the gadget) gets a serializer of its own.
//
// Every event:  ts (timestamp), agent (agentId), kind, k (key), t (elapsed, in a timeline), th (thought, when there is one),
//               end: 1 (it closed the turn), fr (its text in French, when it is known in advance: the demo)
// And by kind, below: how each kind is written (`write`) and read back (`read`). Reading what was written gives the same event.
const { eventClassFor } = require('../models');
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
  if (!kind) throw new Error(`${event.constructor.name} events are not sent to displays`);
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

// A timeline as the page reads it: the same object, with its events serialized.
const serializeTimeline = (timeline) => ({ ...timeline, events: timeline.events.map(serializeEvent) });
const deserializeTimeline = (wire) => ({ ...wire, events: wire.events.map(deserializeEvent) });

module.exports = { serializeEvent, deserializeEvent, serializeTimeline, deserializeTimeline };
