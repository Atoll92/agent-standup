// The events of a timeline: one class per kind, and the registry that says which class a kind is.
//
// What a transcript says, before the timeline is built: Say ('say'), ToolCall ('tool'), AgentCall ('agentcall'), AgentDone ('agentdone'),
// Results ('results'), UserMessage ('user'), Compact ('compact'), WorkflowRun ('wfrun'), WorkflowDone ('wfdone').
// What the timeline makes of them: ToolBeat ('tools'), Order ('order'), Report ('report'), Finish ('finish'), Usage ('usage').
const { UnknownEventKind } = require('../errors');
const { Event } = require('./event');
const { Say } = require('./say');
const { Report } = require('./report');
const { ToolCall } = require('./toolCall');
const { ToolBeat } = require('./toolBeat');
const { Results } = require('./results');
const { UserMessage } = require('./userMessage');
const { Order } = require('./order');
const { Finish } = require('./finish');
const { Usage } = require('./usage');
const { Compact } = require('./compact');
const { AgentCall } = require('./agentCall');
const { AgentDone } = require('./agentDone');
const { WorkflowRun } = require('./workflowRun');
const { WorkflowDone } = require('./workflowDone');

const EVENT_CLASSES = [Say, Report, ToolCall, ToolBeat, Results, UserMessage, Order, Finish, Usage, Compact, AgentCall, AgentDone, WorkflowRun, WorkflowDone];

// kind → class, built from the classes themselves: a kind is written once, on its class.
const BY_KIND = new Map(EVENT_CLASSES.map((EventClass) => [EventClass.kind, EventClass]));

// The class of an event of that kind. Throws UnknownEventKind.
function eventClassFor(kind) {
  const EventClass = BY_KIND.get(kind);
  if (!EventClass) throw new UnknownEventKind(kind);
  return EventClass;
}

module.exports = {
  Event, Say, Report, ToolCall, ToolBeat, Results, UserMessage, Order, Finish, Usage, Compact, AgentCall, AgentDone, WorkflowRun, WorkflowDone,
  EVENT_CLASSES, eventClassFor,
};
