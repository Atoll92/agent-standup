// The format the page (public/index.html) reads: the core's models, in the short names the page has always used.
// This is the only place that knows them. A display with another format (the gadget) gets a serializer of its own.
//
// Every event:  ts (timestamp), agent (agentId), kind, k (key), t (elapsed, in a timeline), th (thought, when there is one), end: 1 (it closed the turn)
// And by kind:
const DETAILS = {
  say: (event) => ({ text: event.text }),
  report: (event) => ({ text: event.text, to: event.recipientId }),
  tools: (event) => ({ tools: event.tools }),
  results: (event) => ({ items: event.items.map(serializeResultItem) }),
  user: (event) => ({ text: event.text }),
  order: (event) => ({
    to: event.recipientId,
    ...(event.callId ? { toolId: event.callId } : {}),
    bg: event.background,
    ...(event.workflow ? { wf: event.workflow } : {}),
    text: event.text,
    title: event.title,
  }),
  finish: (event) => ({ to: event.recipientId }),
  usage: (event) => ({
    u: { i: event.tokens.input, o: event.tokens.output, r: event.tokens.cacheReads, w: event.tokens.cacheWrites },
    model: event.model,
    ...(event.contextWindow ? { cw: event.contextWindow } : {}),
  }),
  compact: () => ({}),
};

// { id (of the call), err, out, img (pictures, only when some came back) }
const serializeResultItem = (item) => ({ id: item.callId, err: item.failed, out: item.output, ...(item.pictures ? { img: item.pictures } : {}) });

function serializeEvent(event) {
  const details = DETAILS[event.kind];
  if (!details) throw new Error(`${event.constructor.name} events are not sent to displays`);
  return {
    ts: event.timestamp,
    agent: event.agentId,
    kind: event.kind,
    ...details(event),
    ...(event.thought ? { th: event.thought } : {}),
    ...(event.endsTurn ? { end: 1 } : {}),
    ...(event.key !== undefined ? { k: event.key } : {}),
    ...(event.elapsed !== undefined ? { t: event.elapsed } : {}),
  };
}

// A timeline as the page reads it: the same object, with its events serialized.
const serializeTimeline = (timeline) => ({ ...timeline, events: timeline.events.map(serializeEvent) });

module.exports = { serializeEvent, serializeTimeline };
