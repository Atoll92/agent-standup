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
  for (const a of Object.values(agents)) if (a.toolUseId) childByTool[a.toolUseId] = a.id;

  const runByTool = {};
  for (const state of states) {
    if (!state) continue;
    for (const e of state.raw) {
      const run = e.kind === 'wfrun' ? runs[e.run] : null;
      if (!run || run.by) continue;
      run.by = e.agent; run.toolId = e.toolId;
      runByTool[e.toolId] = run;
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
    for (const e of state.raw) {
      if (e.kind !== 'agentdone') continue;
      if (childByTool[e.toolId]) finished.add(childByTool[e.toolId]);
      else if (runByTool[e.toolId]) for (const a of Object.values(runByTool[e.toolId].agents)) finished.add(a);   // a run that stopped: so did every agent in it
    }
  }
  for (const run of Object.values(runs)) for (const a of run.done) finished.add(a);

  const subAgents = Object.values(agents).filter((a) => a.id !== 'main');
  let recentUntil = 0;
  for (const a of subAgents) if (a.mtime && now - a.mtime <= QUIET_MS) recentUntil = Math.max(recentUntil, a.mtime + QUIET_MS + 1000);
  for (const a of subAgents) if (now - (a.mtime || 0) > QUIET_MS) finished.add(a.id);
  return { finished, recentUntil };
}

// ---- 4. The events

// Every agent's events, plus the ones no single record says: the orders (from the parent's call or the workflow's first message),
// the reports (the last thing a finished sub-agent says), the finishes, and the token usage.
function collectEvents({ agents, states, runs }, { childByTool, runByTool }, finished) {
  const events = [], parent = {}, finishedSeen = new Set(), lastTs = {};
  for (const state of states) if (state) lastTs[state.agent] = state.lastTs || 0;

  // One finish per agent, whichever record says it first: the key is the agent, not the record.
  const finish = (agent, ts, by) => {
    if (finishedSeen.has(agent)) return;
    finishedSeen.add(agent);
    events.push({ ts, agent, kind: 'finish', to: by, k: 'f/' + agent });
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

    state.raw.forEach((e, i) => {
      if (e.kind === 'agentdone') {
        const child = childByTool[e.toolId], workflow = runByTool[e.toolId];
        if (child) finish(child, e.ts, e.agent);
        else if (workflow) for (const a of Object.values(workflow.agents)) if (!workflow.done.has(a)) finish(a, Math.max(e.ts, lastTs[a] || 0), e.agent);   // the agents the journal knows about are finished below, at their own time
      } else if (e.kind === 'agentcall') {
        const child = childByTool[e.toolId];
        if (!child) return;
        parent[child] = e.agent;
        events.push({ ts: e.ts, agent: e.agent, to: child, kind: 'order', toolId: e.toolId, bg: e.bg, text: e.text, title: e.title, k: e.k });
      } else if (e.kind === 'wfrun' || e.kind === 'wfdone') {
        return;   // bookkeeping of the workflow, nothing to show
      } else if (i === reportAt) {
        events.push({ ...e, kind: 'report', to: null });   // `to` is filled below, once every order is known
      } else {
        events.push(e);
      }
    });

    // The journal has no times: the agent finished when it last wrote.
    if (run && run.done.has(state.agent) && state.lastTs) finish(state.agent, state.lastTs, parent[state.agent] || 'main');

    for (const [messageId, usage] of state.msgUsage) {
      events.push({ ts: usage.ts, agent: state.agent, kind: 'usage', u: usage.u, model: usage.model, ...(usage.cw ? { cw: usage.cw } : {}), k: 'u/' + state.agent + '/' + messageId });
    }
  }

  for (const e of events) if (e.kind === 'report' && e.to === null) e.to = parent[e.agent] || 'main';
  return events;
}

// The last thing a sub-agent says is its report back to the lead.
function lastSayIndex(state) {
  for (let i = state.raw.length - 1; i >= 0; i--) if (state.raw[i].kind === 'say') return i;
  return -1;
}

// ---- 5. Sorted, with consecutive tool calls grouped

// Consecutive tool calls of one agent become one activity beat ("tools" event); bookkeeping events are transparent to that rule.
// A beat keeps the key of its first call; one that closed a turn takes no more calls.
function mergeToolBeats(events) {
  events.sort((a, b) => a.ts - b.ts);
  const merged = [];
  let last = -1;   // index in `merged` of the last event that is not bookkeeping
  for (const e of events) {
    if (BOOKKEEPING.has(e.kind)) { merged.push(e); continue; }
    const prev = last >= 0 ? merged[last] : null;
    if (e.kind === 'tool' && prev && prev.kind === 'tools' && prev.agent === e.agent && !prev.end) {
      prev.tools.push(e.tool);
      if (e.end) prev.end = 1;
    } else {
      merged.push(e.kind === 'tool' ? { ts: e.ts, agent: e.agent, kind: 'tools', tools: [e.tool], ...(e.end ? { end: 1 } : {}), ...(e.th ? { th: e.th } : {}), k: e.k } : e);
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
    const first = merged.find((e) => !BOOKKEEPING.has(e.kind));
    const start = first ? first.ts : 0;
    const end = merged.length ? merged[merged.length - 1].ts : 0;
    return {
      id,
      proj,
      agents: Object.values(session.agents),
      events: merged.map((e) => ({ ...e, t: Math.max(0, e.ts - start) })),
      durationMs: end - start,
      recentUntil,
    };
  }
  return { buildTimeline };
}

module.exports = { createTimeline, BOOKKEEPING };
