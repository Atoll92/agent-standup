// The core's models of what happens in a session.
//
// AGENTS (agent.js): who is in the call. TIMELINE (timeline.js): a session as a call, its agents and its events.
// SESSION STATUS (sessionStatus.js): what a session is doing right now, one row of the board.
//
// EVENTS (events/, extending Event) are what a display shows:
//   from the transcript   Say ('say'), ToolCall ('tool'), Results ('results'), UserMessage ('user'), Compact ('compact')
//   made by the timeline  ToolBeat ('tools': consecutive ToolCalls), Order ('order'), Report ('report'), Finish ('finish'), Usage ('usage')
// SIGNALS (signals/, extending Signal) are what the timeline reads to build them, and then drops:
//   AgentCall ('agentcall'), AgentDone ('agentdone'), WorkflowRun ('wfrun'), WorkflowDone ('wfdone')
const { UnknownEventKind } = require('../errors');
const { Agent } = require('./agent');
const { Timeline } = require('./timeline');
const { SessionStatus } = require('./sessionStatus');
const { Event } = require('./event');
const { Signal } = require('./signal');
const { Say } = require('./events/say');
const { Report } = require('./events/report');
const { ToolCall } = require('./events/toolCall');
const { ToolBeat } = require('./events/toolBeat');
const { Results } = require('./events/results');
const { UserMessage } = require('./events/userMessage');
const { Order } = require('./events/order');
const { Finish } = require('./events/finish');
const { Usage } = require('./events/usage');
const { Compact } = require('./events/compact');
const { AgentCall } = require('./signals/agentCall');
const { AgentDone } = require('./signals/agentDone');
const { WorkflowRun } = require('./signals/workflowRun');
const { WorkflowDone } = require('./signals/workflowDone');

const EVENT_CLASSES = [Say, Report, ToolCall, ToolBeat, Results, UserMessage, Order, Finish, Usage, Compact];
const SIGNAL_CLASSES = [AgentCall, AgentDone, WorkflowRun, WorkflowDone];

// kind → class of event, built from the classes themselves: a kind is written once, on its class.
const EVENT_BY_KIND = new Map(EVENT_CLASSES.map((EventClass) => [EventClass.kind, EventClass]));

// The class of an event of that kind. Throws UnknownEventKind, for a signal's kind too: a signal is not an event.
function eventClassFor(kind) {
  const EventClass = EVENT_BY_KIND.get(kind);
  if (!EventClass) throw new UnknownEventKind(kind);
  return EventClass;
}

module.exports = {
  Agent, Timeline, SessionStatus,
  Event, Say, Report, ToolCall, ToolBeat, Results, UserMessage, Order, Finish, Usage, Compact,
  Signal, AgentCall, AgentDone, WorkflowRun, WorkflowDone,
  EVENT_CLASSES, SIGNAL_CLASSES, eventClassFor,
};
