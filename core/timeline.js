// Merges a session's main transcript and its sub-agents' into one timeline of events, sorted by time.
const fs = require('fs'), path = require('path');
const codex = require('../codex.js');
const { ROOT } = require('./config');
const { clip, toolLabel, RESULT_MAX } = require('./transcript');
const { mtimeOf, subFiles, readMeta } = require('./sessionFiles');
const { readNew } = require('./reader');
const { parseRecord } = require('./claudeRecord');

const codexRecord = codex.parser({ toolLabel, clip, resultMax: RESULT_MAX });
function buildTimeline(proj, id, files = []) {
  const cx = proj === codex.PROJ, base = path.join(ROOT, proj), mainFile = cx ? codex.fileOf(id) || '' : path.join(base, id + '.jsonl');   // a Codex session is one file somewhere else, in another format (codexRecord); from here on it is a session like any other, without sub-agents
  if (!fs.existsSync(mainFile)) throw new Error('session not found');
  const agents = { main: { id: 'main', role: 'Lead', type: 'main', ...(cx ? { name: 'Codex' } : {}) } };
  const states = [readNew(mainFile, 'main', false, cx ? codexRecord : parseRecord)], subs = subFiles(proj, id), runs = {}; files.push(mainFile);   // runs: workflow run → { agents (file name → agent id), by (who launched it), toolId, done }
  for (const x of subs) {
    const aid = x.aid, m = readMeta(x.file.replace(/\.jsonl$/, '.meta.json'));
    agents[aid] = { id: aid, role: m.description || m.workflowPhase || m.agentType || 'Agent', type: m.agentType || 'agent', toolUseId: m.toolUseId };
    if (x.run) { agents[aid].wf = x.run; if (m.workflowPhase) agents[aid].phase = m.workflowPhase; (runs[x.run] = runs[x.run] || { agents: {}, done: new Set() }).agents[x.id0] = aid; }   // launched by a workflow: no Agent call of the lead points at it
    agents[aid].mtime = mtimeOf(x.file) || undefined;
    const st = readNew(x.file, aid); if (st) states.push(st); files.push(x.file);
  }
  for (const j of subs.journals) { const st = readNew(j.file, 'wf:' + j.run, true), run = runs[j.run]; files.push(j.file); if (st && run) for (const e of st.raw) if (run.agents[e.child]) run.done.add(run.agents[e.child]); }
  const childByTool = {};   // Agent tool_use id → the sub-agent it created, so we know who ordered whom
  for (const a of Object.values(agents)) if (a.toolUseId) childByTool[a.toolUseId] = a.id;
  const runByTool = {}; for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'wfrun' && runs[e.run] && !runs[e.run].by) { runs[e.run].by = e.agent; runs[e.run].toolId = e.toolId; runByTool[e.toolId] = runs[e.run]; }   // Workflow tool_use id → the run it started

  const finished = new Set(), now0 = Date.now(); for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'agentdone') { if (childByTool[e.toolId]) finished.add(childByTool[e.toolId]); else if (runByTool[e.toolId]) for (const a of Object.values(runByTool[e.toolId].agents)) finished.add(a); }   // a run that stopped: so did every agent in it
  for (const run of Object.values(runs)) for (const a of run.done) finished.add(a);
  let recentUntil = 0; for (const a of Object.values(agents)) if (a.id !== 'main' && a.mtime && now0 - a.mtime <= 240000) recentUntil = Math.max(recentUntil, a.mtime + 241000);
  for (const a of Object.values(agents)) if (a.id !== 'main' && now0 - (a.mtime || 0) > 240000) finished.add(a.id);   // old transcripts without a completion record: silent for 4 min counts as finished
  const events = [], parent = {}, doneSeen = new Set(), lastTs = {}; for (const st of states) if (st) lastTs[st.agent] = st.lastTs || 0;
  const finish = (to, ts, by) => { if (!doneSeen.has(to)) { doneSeen.add(to); events.push({ ts, agent: to, kind: 'finish', to: by, k: 'f/' + to }); } };   // one per agent, whichever record says it first: the key is the agent, not the record
  for (const st of states) {
    if (!st) continue;
    let lastSay = -1;   // the last thing a sub-agent says is its report back to the lead
    if (st.agent !== 'main' && finished.has(st.agent)) for (let i = st.raw.length - 1; i >= 0; i--) if (st.raw[i].kind === 'say') { lastSay = i; break; }
    const run = agents[st.agent] && agents[st.agent].wf ? runs[agents[st.agent].wf] : null;
    if (run && st.prompt) { parent[st.agent] = run.by || 'main'; events.push({ ts: st.prompt.ts, agent: parent[st.agent], to: st.agent, kind: 'order', ...(run.toolId ? { toolId: run.toolId } : {}), bg: true, wf: agents[st.agent].wf, text: st.prompt.text, title: agents[st.agent].role, k: 'o/' + st.agent }); }   // the order a workflow gave is the first message of the agent's own file: shown as an order from whoever launched the workflow (the lead when nothing says who), given in the background, when the agent started
    st.raw.forEach((e, i) => {
      if (e.kind === 'agentdone') { const to = childByTool[e.toolId], wr = runByTool[e.toolId]; if (to) finish(to, e.ts, e.agent); else if (wr) for (const a of Object.values(wr.agents)) if (!wr.done.has(a)) finish(a, Math.max(e.ts, lastTs[a] || 0), e.agent); }   // the agents the journal knows about are finished below, at their own time
      else if (e.kind === 'agentcall') { const to = childByTool[e.toolId]; if (to) { parent[to] = e.agent; events.push({ ts: e.ts, agent: e.agent, to, kind: 'order', toolId: e.toolId, bg: e.bg, text: e.text, title: e.title, k: e.k }); } }
      else if (e.kind === 'wfrun' || e.kind === 'wfdone') return;
      else if (i === lastSay) events.push({ ...e, kind: 'report', to: null });   // `to` filled below, once every order is known
      else events.push(e);
    });
    if (run && run.done.has(st.agent) && st.lastTs) finish(st.agent, st.lastTs, parent[st.agent] || 'main');   // the journal has no times: the agent finished when it last wrote
    for (const [mid, mu] of st.msgUsage) events.push({ ts: mu.ts, agent: st.agent, kind: 'usage', u: mu.u, model: mu.model, ...(mu.cw ? { cw: mu.cw } : {}), k: 'u/' + st.agent + '/' + mid });
  }
  for (const e of events) if (e.kind === 'report' && e.to === null) e.to = parent[e.agent] || 'main';

  events.sort((a, b) => a.ts - b.ts);
  const merged = []; let lastReal = -1;   // consecutive tool calls of one agent become one activity beat; usage events are transparent to that rule
  for (const e of events) {
    const p = lastReal >= 0 ? merged[lastReal] : null;
    if (e.kind === 'usage' || e.kind === 'finish' || e.kind === 'compact') { merged.push(e); continue; }
    if (e.kind === 'tool' && p && p.kind === 'tools' && p.agent === e.agent && !p.end) { p.tools.push(e.tool); if (e.end) p.end = 1; }   // a beat keeps the key of its first call; one that closed a turn takes no more calls
    else { merged.push(e.kind === 'tool' ? { ts: e.ts, agent: e.agent, kind: 'tools', tools: [e.tool], ...(e.end ? { end: 1 } : {}), ...(e.th ? { th: e.th } : {}), k: e.k } : e); lastReal = merged.length - 1; }
  }
  const real = merged.find((e) => e.kind !== 'usage' && e.kind !== 'finish' && e.kind !== 'compact'), first = real ? real.ts : 0, last = merged.length ? merged[merged.length - 1].ts : 0;   // time zero = the first thing said or done
  return { id, proj, agents: Object.values(agents), events: merged.map((e) => ({ ...e, t: Math.max(0, e.ts - first) })), durationMs: last - first, recentUntil };
}

module.exports = { buildTimeline };
