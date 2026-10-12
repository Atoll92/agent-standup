// The events of a timeline. One class per kind (the `kind` each carries on the wire is in its comment).
//
// What a transcript says, before the timeline is built: Say ('say'), ToolCall ('tool'), AgentCall ('agentcall'), AgentDone ('agentdone'),
// Results ('results'), UserMessage ('user'), Compact ('compact'), WorkflowRun ('wfrun'), WorkflowDone ('wfdone').
// What the timeline makes of them: ToolBeat ('tools'), Order ('order'), Report ('report'), Finish ('finish'), Usage ('usage').
module.exports = {
  ...require('./event'), ...require('./say'), ...require('./report'), ...require('./toolCall'), ...require('./toolBeat'), ...require('./results'),
  ...require('./userMessage'), ...require('./order'), ...require('./finish'), ...require('./usage'), ...require('./compact'),
  ...require('./agentCall'), ...require('./agentDone'), ...require('./workflowRun'), ...require('./workflowDone'),
};
