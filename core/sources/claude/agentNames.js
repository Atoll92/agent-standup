// A sub-agent the person named keeps that name on screen: the name given when it was launched, or else its type when that type is
// the person's own (.claude/agents/code-reviewer.md → "Code Reviewer"). The types Claude Code ships are not names: those agents get
// a first name from the page, as before.
const { AgentCall } = require('../../models');

const STOCK_TYPES = /^(general-purpose|explore|plan|claude|agent|task|fork|main|default|worker|subagent|workflow-subagent|statusline-setup|output-style-setup|claude-code-guide|verification|magic-docs)$/i;
const MAX_LENGTH = 26;

// What to call an agent from a launch name or (isType) an agent type: words, capitalized when written all in lower case; '' when it is no name.
function ownNameOf(text, isType = false) {
  const raw = String(text || '').split(':').pop().trim();   // a plugin's agent is written plugin:agent
  if (!raw || (isType && STOCK_TYPES.test(raw))) return '';
  let name = raw.replace(/[_\-]+/g, ' ').replace(/[^\p{L}\p{N} .'’&+]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(name)) return '';
  if (name === name.toLowerCase()) name = name.replace(/(^|\s)\p{Ll}/gu, (letter) => letter.toUpperCase());
  return name.length > MAX_LENGTH ? name.slice(0, MAX_LENGTH - 1).trimEnd() + '…' : name;
}

// Gives each sub-agent of `agents` its own name, when it has one. Two agents of the same name are numbered in the order they started,
// so that the second one is "Code Reviewer 2" and stays so.
function nameAgents(agents, states) {
  const byLaunch = {}, launchName = {}, startedAt = {};
  for (const agent of Object.values(agents)) if (agent.launchCallId) byLaunch[agent.launchCallId] = agent.id;
  for (const state of states) {
    if (!state) continue;
    if (state.records.length) startedAt[state.agentId] = state.records[0].timestamp;
    for (const record of state.records) if (record instanceof AgentCall && record.name && byLaunch[record.callId]) launchName[byLaunch[record.callId]] = record.name;
  }

  const subAgents = Object.values(agents).filter((agent) => !agent.isLead)
    .sort((first, second) => (startedAt[first.id] || Infinity) - (startedAt[second.id] || Infinity) || (first.id < second.id ? -1 : 1));
  const seen = {};
  for (const agent of subAgents) {
    const name = ownNameOf(launchName[agent.id]) || ownNameOf(agent.type, true);
    if (!name) continue;
    const key = name.toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    agent.ownName = seen[key] > 1 ? name + ' ' + seen[key] : name;
  }
}

module.exports = { nameAgents, ownNameOf };
