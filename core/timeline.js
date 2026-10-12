// Merges the transcripts of a session (the lead's and its sub-agents') into one timeline of events, sorted by time.
//
// The session's source (see core/index.js) finds its files and reads them: that is what depends on the tool. What is left is the same for all:
//   1. the source       reads the session: its agents, and the events of each (see sources/claude/session.js)
//   2. linkLaunches    works out who launched whom
//   3. findFinished    works out which agents are done
//   4. collectEvents   gathers every agent's events, adding the orders, the reports and the finishes that no single record says
//   5. mergeToolBeats  sorts them by time and groups consecutive tool calls
// The agents that launch agents (Claude Code's Agent tool and workflows) are part of this model; a source with a single agent, as Codex, just has none.

// An old transcript without a completion record counts as finished once it has been silent this long.
const QUIET_MS = 4 * 60 * 1000;
// Events that say nothing about what an agent is doing: they neither start the call nor interrupt a beat of tool calls.
const BOOKKEEPING = new Set(['usage', 'finish', 'compact']);

// ---- 2. Who launched whom

// Returns { childByTool, runByTool }:
//   childByTool  Agent tool_use id → the sub-agent it created, so we know who ordered whom
//   runByTool    Workflow tool_use id → the run it started (the run also learns who launched it, and with which call)
function linkLaunches({ agents, states, runs }) {
  const childByTool = {};
  for (const agent of Object.values(agents)) if (agent.toolUseId) childByTool[agent.toolUseId] = agent.id;

  const runByTool = {};
  for (const state of states) {
    if (!state) continue;
    for (const event of state.raw) {
      const run = event.kind === 'wfrun' ? runs[event.run] : null;
      if (!run || run.by) continue;
      run.by = event.agent; run.toolId = event.toolId;
      runByTool[event.toolId] = run;
    }
  }
  return { childByTool, runByTool };
}

// ---- 3. Who is done

// Returns { finished: Set of agent ids, recentUntil }. recentUntil is when the answer can change without any file being written:
// a sub-agent that is quiet for QUIET_MS flips to finished on its own.
function findFinished({ agents, states, runs }, { childByTool, runByTool }) {
  const now = Date.now(), finished = new Set();

  for (const state of states) {
    if (!state) continue;
    for (const event of state.raw) {
      if (event.kind !== 'agentdone') continue;
      if (childByTool[event.toolId]) finished.add(childByTool[event.toolId]);
      else if (runByTool[event.toolId]) for (const agentId of Object.values(runByTool[event.toolId].agents)) finished.add(agentId);   // a run that stopped: so did every agent in it
    }
  }
  for (const run of Object.values(runs)) for (const agentId of run.done) finished.add(agentId);

  const subAgents = Object.values(agents).filter((agent) => agent.id !== 'main');
  let recentUntil = 0;
  for (const agent of subAgents) if (agent.mtime && now - agent.mtime <= QUIET_MS) recentUntil = Math.max(recentUntil, agent.mtime + QUIET_MS + 1000);
  for (const agent of subAgents) if (now - (agent.mtime || 0) > QUIET_MS) finished.add(agent.id);
  return { finished, recentUntil };
}

// ---- 4. The events

// Every agent's events, plus the ones no single record says: the orders (from the parent's call or the workflow's first message),
// the reports (the last thing a finished sub-agent says), the finishes, and the token usage.
function collectEvents({ agents, states, runs }, { childByTool, runByTool }, finished) {
  const events = [], parent = {}, finishedSeen = new Set(), lastTs = {};
  for (const state of states) if (state) lastTs[state.agent] = state.lastTs || 0;

  // One finish per agent, whichever record says it first: the key is the agent, not the record.
  const finish = (agent, ts, reportsTo) => {
    if (finishedSeen.has(agent)) return;
    finishedSeen.add(agent);
    events.push({ ts, agent, kind: 'finish', to: reportsTo, k: 'f/' + agent });
  };

  for (const state of states) {
    if (!state) continue;
    const agent = agents[state.agent], run = agent && agent.wf ? runs[agent.wf] : null;
    const reportAt = state.agent !== 'main' && finished.has(state.agent) ? lastSayIndex(state) : -1;

    // The order a workflow gave is the first message of the agent's own file: shown as an order from whoever launched
    // the workflow (the lead when nothing says who), given in the background, when the agent started.
    if (run && state.prompt) {
      parent[state.agent] = run.by || 'main';
      events.push({ ts: state.prompt.ts, agent: parent[state.agent], to: state.agent, kind: 'order', ...(run.toolId ? { toolId: run.toolId } : {}), bg: true, wf: agent.wf, text: state.prompt.text, title: agent.role, k: 'o/' + state.agent });
    }

    state.raw.forEach((event, index) => {
      if (event.kind === 'agentdone') {
        const child = childByTool[event.toolId], workflow = runByTool[event.toolId];
        if (child) finish(child, event.ts, event.agent);
        else if (workflow) for (const agentId of Object.values(workflow.agents)) if (!workflow.done.has(agentId)) finish(agentId, Math.max(event.ts, lastTs[agentId] || 0), event.agent);   // the agents the journal knows about are finished below, at their own time
      } else if (event.kind === 'agentcall') {
        const child = childByTool[event.toolId];
        if (!child) return;
        parent[child] = event.agent;
        events.push({ ts: event.ts, agent: event.agent, to: child, kind: 'order', toolId: event.toolId, bg: event.bg, text: event.text, title: event.title, k: event.k });
      } else if (event.kind === 'wfrun' || event.kind === 'wfdone') {
        return;   // bookkeeping of the workflow, nothing to show
      } else if (index === reportAt) {
        events.push({ ...event, kind: 'report', to: null });   // `to` is filled below, once every order is known
      } else {
        events.push(event);
      }
    });

    // The journal has no times: the agent finished when it last wrote.
    if (run && run.done.has(state.agent) && state.lastTs) finish(state.agent, state.lastTs, parent[state.agent] || 'main');

    for (const [messageId, usage] of state.msgUsage) {
      events.push({ ts: usage.ts, agent: state.agent, kind: 'usage', u: usage.u, model: usage.model, ...(usage.cw ? { cw: usage.cw } : {}), k: 'u/' + state.agent + '/' + messageId });
    }
  }

  for (const event of events) if (event.kind === 'report' && event.to === null) event.to = parent[event.agent] || 'main';
  return events;
}

// The last thing a sub-agent says is its report back to the lead.
function lastSayIndex(state) {
  for (let index = state.raw.length - 1; index >= 0; index--) if (state.raw[index].kind === 'say') return index;
  return -1;
}

// ---- 5. Sorted, with consecutive tool calls grouped

// Consecutive tool calls of one agent become one activity beat ("tools" event); bookkeeping events are transparent to that rule.
// A beat keeps the key of its first call; one that closed a turn takes no more calls.
function mergeToolBeats(events) {
  events.sort((first, second) => first.ts - second.ts);
  const merged = [];
  let last = -1;   // index in `merged` of the last event that is not bookkeeping
  for (const event of events) {
    if (BOOKKEEPING.has(event.kind)) { merged.push(event); continue; }
    const prev = last >= 0 ? merged[last] : null;
    if (event.kind === 'tool' && prev && prev.kind === 'tools' && prev.agent === event.agent && !prev.end) {
      prev.tools.push(event.tool);
      if (event.end) prev.end = 1;
    } else {
      merged.push(event.kind === 'tool' ? { ts: event.ts, agent: event.agent, kind: 'tools', tools: [event.tool], ...(event.end ? { end: 1 } : {}), ...(event.th ? { th: event.th } : {}), k: event.k } : event);
      last = merged.length - 1;
    }
  }
  return merged;
}

// `sourceOf(proj)` gives the source a session belongs to.
function createTimeline({ sourceOf }) {
  // The timeline of a session: { id, proj, agents, events, durationMs, recentUntil }. Every file read is added to `files`,
  // so the caller can tell when any of them changes.
  function buildTimeline(proj, id, files = []) {
    const session = sourceOf(proj).readSession(proj, id, files);
    const launches = linkLaunches(session);
    const { finished, recentUntil } = findFinished(session, launches);
    const events = collectEvents(session, launches, finished);
    const merged = mergeToolBeats(events);

    // Time zero is the first thing said or done.
    const first = merged.find((event) => !BOOKKEEPING.has(event.kind));
    const start = first ? first.ts : 0;
    const end = merged.length ? merged[merged.length - 1].ts : 0;
    return {
      id,
      proj,
      agents: Object.values(session.agents),
      events: merged.map((event) => ({ ...event, t: Math.max(0, event.ts - start) })),
      durationMs: end - start,
      recentUntil,
    };
  }
  return { buildTimeline };
}

module.exports = { createTimeline, BOOKKEEPING };
