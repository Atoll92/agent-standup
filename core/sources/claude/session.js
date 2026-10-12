// Reads one Claude Code session: its main transcript (the lead), one transcript per sub-agent, and for workflows a journal per run.
const fs = require('fs'), path = require('path');
const { parseRecord } = require('./record');
const { nameAgents } = require('./agentNames');
const { mtimeOf } = require('./files');
const { SessionNotFound } = require('../../errors');
const { Agent } = require('../../models');

function createClaudeSession({ root, files, reader }) {
  // Returns { agents, states, runs }:
  //   agents  id → { id, role, type, … } (a plain object: the order of its keys is the order of the agents in the call)
  //   states  one per transcript read (main first, then the sub-agents), as reader.readNew returns them (null for a file that vanished)
  //   runs    workflow run → { agents (file name → agent id), done (agent ids the journal says are finished), by, toolId }
  // Every file read is added to `touched`, so the caller can tell when any of them changes.
  function readSession(proj, id, touched) {
    const mainFile = path.join(root, proj, id + '.jsonl');
    if (!fs.existsSync(mainFile)) throw new SessionNotFound();

    const agents = { [Agent.LEAD_ID]: Agent.lead() };
    const states = [reader.readNew(mainFile, 'main', false, parseRecord)];
    const subs = files.subFiles(proj, id);
    const runs = {};
    touched.push(mainFile);

    for (const sub of subs) {
      const meta = files.readMeta(sub.file.replace(/\.jsonl$/, '.meta.json'));
      const agent = agents[sub.aid] = describeSubAgent(sub, meta);
      if (sub.run) joinWorkflowRun(runs, sub, agent, meta);
      agent.lastActiveAt = mtimeOf(sub.file) || undefined;
      const state = reader.readNew(sub.file, sub.aid, false, parseRecord);
      if (state) states.push(state);
      touched.push(sub.file);
    }

    for (const journal of subs.journals) {
      const state = reader.readNew(journal.file, 'wf:' + journal.run, true, parseRecord), run = runs[journal.run];
      touched.push(journal.file);
      if (state && run) for (const entry of state.records) if (run.agents[entry.childId]) run.done.add(run.agents[entry.childId]);
    }
    nameAgents(agents, states);
    return { agents, states, runs };
  }

  return { readSession };
}

function describeSubAgent(sub, meta) {
  return new Agent({
    id: sub.aid,
    role: meta.description || meta.workflowPhase || meta.agentType || 'Agent',
    type: meta.agentType || 'agent',
    launchCallId: meta.toolUseId,
  });
}

// An agent launched by a workflow: no Agent call of the lead points at it.
function joinWorkflowRun(runs, sub, agent, meta) {
  agent.workflow = sub.run;
  if (meta.workflowPhase) agent.phase = meta.workflowPhase;
  const run = runs[sub.run] = runs[sub.run] || { agents: {}, done: new Set() };
  run.agents[sub.id0] = sub.aid;
}

module.exports = { createClaudeSession };
