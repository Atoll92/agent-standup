#!/usr/bin/env node
// Agent Standup from a terminal: the live call in your browser, and one-line status for status bars (Claude Code, tmux, Neovim…).
//   agent-standup [serve] [--port 4747] [--open]   start the local server and (optionally) open the page
//   agent-standup status [--here] [--json] [--titles]  counts of working / needs you / your turn
//   agent-standup statusline                        same, one short line; reads Claude Code's statusLine JSON on stdin
//   agent-standup report [--day D] [--here] [--json] [--titles]  what each session did that day: time worked, time it waited for you, calls, files (the plugin's whiteboard and timesheet skills read it)
// Everything reads the local session files Claude Code already writes. Nothing is sent anywhere unless the call is in French, Spanish or Brazilian Portuguese or you turn on the jokes (they use your own Claude login or ANTHROPIC_API_KEY).
const path = require('path'), { spawn } = require('child_process');
const pkg = require('../package.json');
const argv = process.argv.slice(2), flags = {}, rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--port') flags.port = val(); else if (a === '--projects') flags.projects = val(); else if (a === '--codex') flags.codex = val(); else if (a === '--vibe') flags.vibe = val(); else if (a === '--cowork') flags.cowork = val(); else if (a === '--characters') flags.characters = val(); else if (a === '--config-dir') flags.config = val();
  else if (a === '--reply') flags.reply = /^(0|1|on|off|yes|no|true|false)$/i.test(argv[i + 1] || '') ? val() : 'on';   // alone or followed by on / off
  else if (a === '--from') flags.from = val(); else if (a === '--open') flags.open = true; else if (a === '--here') flags.here = true; else if (a === '--json') flags.json = true; else if (a === '--titles') flags.titles = true; else if (a === '--config') flags.config = val(); else if (a === '--day') flags.day = val();
  else if (a === '-h' || a === '--help') flags.help = true; else if (a === '-v' || a === '--version') flags.version = true; else rest.push(a);
}
const cmd = rest[0] || 'serve';
const HELP = `Agent Standup ${pkg.version} — your Claude Code, Codex and Mistral Vibe agents as a live video call

Usage
  agent-standup [serve] [--port 4747] [--open]   start the local server (http://localhost:4747)
  agent-standup status [--here] [--json]          what is going on right now (--here: only the current folder)
  agent-standup statusline                        one short line for a status bar (reads Claude Code's JSON on stdin)
  agent-standup report [--day D] [--json]         what each session did that day: time worked, waits for you, calls, files

Options
  --port N          port of the local server (default 4747)
  --open            open the page in your browser
  --projects DIR    where the session files are (default ~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects, and those of
                    each ~/.claude-<name> folder of another account); when it is named projects, the sessions folder
                    beside it is read too (what waits for you)
  --config DIR      Claude Code's config folder, as CLAUDE_CONFIG_DIR (its projects and sessions folders are read, and
                    no other account's)
  --codex DIR       where Codex keeps its files (default ~/.codex, or $CODEX_HOME); "off" to leave Codex sessions out
  --vibe DIR        where Mistral Vibe keeps its files (default ~/.vibe, or $VIBE_HOME); "off" to leave Vibe sessions out
  --cowork DIR      where the Claude desktop app keeps its Cowork sessions (default: its local-agent-mode-sessions folder); "off" to leave them out
  --reply           let the call type into the followed Claude Code session's tmux pane (Linux, off by default; anyone who can run commands as you can then type into your sessions)
  --characters DIR  folder with your own pixel-art characters (default ~/.agent-standup/characters)
  --from plugin     how the Claude Code plugin starts it (its usage, if you agree to share it, is counted apart); also AGENT_STANDUP_FROM=plugin,
                    which older versions ignore instead of refusing
  --here            status, report: only sessions of the current folder (matched on its real path, as Claude Code names it)
  --json            status, report: machine-readable output
  --day D           report: the day to tell, YYYY-MM-DD, today (the default) or yesterday, in local time
  --titles          include session titles, questions, commands and errors
`;
if (flags.help || cmd === 'help') { process.stdout.write(HELP); process.exit(0); }
if (flags.version || cmd === 'version') { console.log(pkg.version); process.exit(0); }
if (flags.projects) process.env.AGENT_STANDUP_PROJECTS = path.resolve(flags.projects);
if (flags.projects && path.basename(path.resolve(flags.projects)) === 'projects' && !process.env.AGENT_STANDUP_CC_SESSIONS) process.env.AGENT_STANDUP_CC_SESSIONS = path.join(path.dirname(path.resolve(flags.projects)), 'sessions');   // another Claude Code folder: its sessions' status (what needs you) is beside its projects
if (flags.codex !== undefined) process.env.AGENT_STANDUP_CODEX = /^(0|off|no|false)?$/i.test(String(flags.codex)) ? 'off' : path.resolve(String(flags.codex));
if (flags.vibe !== undefined) process.env.AGENT_STANDUP_VIBE = /^(0|off|no|false)?$/i.test(String(flags.vibe)) ? 'off' : path.resolve(String(flags.vibe));
if (flags.cowork !== undefined) process.env.AGENT_STANDUP_COWORK = /^(0|off|no|false)?$/i.test(String(flags.cowork)) ? 'off' : path.resolve(String(flags.cowork));
if (flags.reply !== undefined) { if (/^(1|on|yes|true)$/i.test(flags.reply)) process.env.AGENT_STANDUP_REPLY = 'on'; else delete process.env.AGENT_STANDUP_REPLY; }
if (flags.config) { process.env.CLAUDE_CONFIG_DIR = path.resolve(flags.config); process.env.AGENT_STANDUP_CLAUDE_DIRS = 'off'; }   // the one account asked for, not the other Claude Code folders
if (flags.characters) process.env.AGENT_STANDUP_CHARACTERS = path.resolve(flags.characters);
if (flags.port !== undefined) {   // a real port number or nothing: no silent fallback to another port
  if (!/^\d+$/.test(String(flags.port)) || +flags.port < 1 || +flags.port > 65535) { console.error(`Invalid --port "${flags.port}": use a number between 1 and 65535.`); process.exit(2); }
  process.env.PORT = String(+flags.port);
}
process.env.AGENT_STANDUP_HOST = (flags.from || process.env.AGENT_STANDUP_FROM) === 'plugin' ? 'claude code plugin' : 'command line';   // named in a problem report (⚙ › Report a problem), and what the usage count counts (--from plugin or AGENT_STANDUP_FROM=plugin: the Claude Code plugin's commands; the plugin uses the variable, since a version without --from refuses the flag)
const server = require('../server.js');
const projKey = (dir) => String(dir || '').replace(/[^a-zA-Z0-9]/g, '-'), fold = (k) => (process.platform === 'win32' ? String(k || '').toLowerCase() : k);   // Claude Code's project folder naming · fold: on Windows a folder is the same whatever its case (c: or C:)

function snapshot(dir) {
  const now = Date.now(), all = server.boardRows(), rows = dir ? all.filter((r) => fold(r.proj) === fold(projKey(dir)) || (!!r.dir && fold(r.dir) === fold(projKey(dir)))) : all;   // dir: the folder a Codex session was started in, named the same way
  const act = rows.filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), n = (st) => act.filter((r) => r.state === st).length;
  const turn = act.filter((r) => r.state === 'turn'), lim = turn.find((r) => r.limit);   // a session stopped on your usage limit, or on a login that is gone: not a turn you can take
  return { rows: act, needsYou: n('blocked'), working: n('working') + n('waiting'), yourTurn: turn.length, idle: rows.length - act.length, limit: lim ? (turn.every((r) => !r.limit || r.limit.resets === lim.limit.resets) ? lim.limit.resets || '' : '') : null, auth: turn.some((r) => r.auth), free: turn.some((r) => !r.limit && !r.auth) };
}
const line = (s, short) => {
  const p = []; if (s.needsYou) p.push(short ? `✋${s.needsYou}` : `✋ ${s.needsYou} needs you`); if (s.working) p.push(short ? `⚙${s.working}` : `⚙ ${s.working} working`);
  if (s.auth) p.push(short ? '⚠login' : '⚠ logged out: run /login'); if (s.limit != null) p.push(short ? '⏳' + s.limit.replace(/\s*\([^)]*\)\s*$/, '') : '⏳ usage limit' + (s.limit ? ' · resets ' + s.limit : ''));   // short: the time without its zone
  if (!s.needsYou && !s.working && s.free) p.push(short ? '✓' : '✓ your turn'); return p.join(short ? ' ' : ' · ') || (short ? '' : 'idle');
};

// What each session did in one day, from the timelines the call is drawn from: what the plugin's whiteboard (the standup, drawn) and timesheet (a row a session) skills fill their artifact with.
// Time is told from the gaps between a session's events, all its agents together (sub-agents working side by side are not counted twice): a gap of up to 10 minutes inside a turn is work; the gap
// before your next message, and a longer one inside a turn (most often a question or a permission menu, sometimes a long command), is time it waited for you, an hour at most each (a session left for the night did not wait all night).
const GAP_WORK = 10 * 60e3, GAP_WAIT = 60 * 60e3, pad = (n) => String(n).padStart(2, '0');
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${pad(min % 60)}` : `${min}m`), clipT = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function dayRange(d) {   // [start, end) of a local day
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (d === 'yesterday') t.setDate(t.getDate() - 1);
  else if (d && d !== 'today') { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) { console.error(`Invalid --day "${d}": use YYYY-MM-DD, today or yesterday.`); process.exit(2); } t.setFullYear(+m[1], +m[2] - 1, +m[3]); if (t.getMonth() !== +m[2] - 1) { console.error(`Invalid --day "${d}": there is no such day.`); process.exit(2); } }
  const end = new Date(t); end.setDate(end.getDate() + 1); return [+t, +end];
}
const TOOLS = { codex: 'Codex', vibe: 'Mistral Vibe', cowork: 'Cowork' }, projLabel = (p) => (path.isAbsolute(String(p)) ? String(p).split(/[\\/]+/).filter(Boolean).slice(-2).join('/') : p);   // a folder written whole (Codex, Vibe): its last two names, as Claude Code's projects read
const CALLS = { cmd: 'commands', edit: 'edits', write: 'edits', read: 'reads', web: 'web', browser: 'browser', artifact: 'artifacts' };
function report(day, dir, titles) {
  const [from, to] = dayRange(day), live = new Map(server.boardRows().map((r) => [r.proj + '/' + r.id, r])), home = require('os').homedir(), short = (f) => (f.startsWith(home + path.sep) ? '~' + f.slice(home.length) : f), rows = [];
  for (const r of (server.sessionsSince ? server.sessionsSince(from) : server.sessionRows())) {   // every session written since that day began, not only the most recent ones
    if (r.mtime < from) continue;
    const b = live.get(r.proj + '/' + r.id);
    if (dir && !(fold(r.proj) === fold(projKey(dir)) || (b && b.dir && fold(b.dir) === fold(projKey(dir))))) continue;
    let tl; try { tl = server.timeline(r.proj, r.id); } catch { continue; }   // a session that cannot be read costs that session only
    const ev = tl.events.filter((e) => e.ts >= from && e.ts < to).sort((x, y) => x.ts - y.ts); if (!ev.length) continue;
    let work = 0, wait = 0, turns = 0, asked = '', said = ''; const calls = {}, files = new Set(), subs = new Set(), arts = new Map();
    ev.forEach((e, i) => {
      if (e.kind === 'user') { turns++; if (!asked) asked = e.text; }
      if (e.kind === 'say' && e.agent === 'main') said = e.text;
      if (e.agent !== 'main' && e.agent !== 'user') subs.add(e.agent);
      if (e.kind === 'tools') for (const t of e.tools) { const k = CALLS[t.d && t.d.kind] || 'other'; calls[k] = (calls[k] || 0) + 1; if (t.d && (t.d.kind === 'edit' || t.d.kind === 'write') && typeof t.d.file === 'string' && t.d.file) files.add(short(t.d.file)); }
      if (e.kind === 'results') for (const it of e.items) if (it.art && it.art.url) arts.set(it.art.url, it.art.title || (arts.get(it.art.url) || ''));
      if (i) { const gap = ev[i].ts - ev[i - 1].ts; if (e.kind === 'user' || gap > GAP_WORK) wait += Math.min(gap, GAP_WAIT); else work += gap; }
    });
    rows.push({ project: projLabel(r.project || r.proj), tool: TOOLS[r.source] || r.source || (r.project === 'Cowork' ? 'Cowork' : 'Claude Code'), id: r.id, state: b ? b.state : 'idle', start: hm(ev[0].ts), end: hm(ev[ev.length - 1].ts), t0: ev[0].ts,
      workMin: Math.round(work / 60e3), waitMin: Math.round(wait / 60e3), turns, subAgents: subs.size, calls, filesChanged: files.size,
      ...(titles ? { title: clipT(r.title, 120), asked: clipT(asked, 240), said: clipT(said, 400), files: [...files].slice(0, 30), artifacts: [...arts].map(([url, title]) => ({ title: clipT(title, 120), url })) } : {}) });
  }
  rows.sort((a, b) => a.t0 - b.t0); rows.forEach((r) => delete r.t0);
  return { day: ymd(from), sessions: rows.length, workMin: rows.reduce((n, r) => n + r.workMin, 0), waitMin: rows.reduce((n, r) => n + r.waitMin, 0), rows };
}

if (cmd === 'status') {
  const s = snapshot(flags.here ? process.cwd() : '');
  if (flags.json) console.log(JSON.stringify({ needsYou: s.needsYou, working: s.working, yourTurn: s.yourTurn, idle: s.idle, sessions: s.rows.map((r) => ({ project: r.proj, id: r.id, state: r.state, tool: r.tool, ageMs: Math.round(r.ageMs), subAgentsActive: r.subActive, subAgents: r.subTotal, ...(r.since ? { since: r.since } : {}), ...(r.ran ? { ran: r.ran } : {}), ...(r.limit ? { limit: r.limit } : {}), ...(r.auth ? { auth: 1 } : {}), ...(flags.titles ? { title: r.title, ...(r.ask ? { ask: r.ask } : {}), ...(r.menu && r.menu.about ? { about: r.menu.about } : {}), ...(r.gave ? { gave: r.gave } : {}) } : {}) })) }, null, 2));   // since: when it started to wait, ran: how long it worked before · with --titles only, what the sessions say (it can hold a path, a command or a secret): ask, the question or command that waits for you, about, what that command is for, gave, the error it stopped on
  else console.log(line(s, false));
} else if (cmd === 'report') {
  const rep = report(flags.day, flags.here ? process.cwd() : '', flags.titles), callLine = (c) => Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, '') : k}`).join(' · ');
  const text = flags.json ? JSON.stringify(rep, null, 2) : [`${rep.day} · ${rep.sessions} session${rep.sessions === 1 ? '' : 's'} · ${dur(rep.workMin)} worked · ${dur(rep.waitMin)} waited for you`,
    ...rep.rows.map((r) => `  ${r.start}–${r.end}  ${(r.tool + ' · ' + r.project).padEnd(36).slice(0, 36)}  ${dur(r.workMin).padStart(5)} worked  ${dur(r.waitMin).padStart(5)} waited  ${callLine(r.calls)}${r.title ? '\n      ' + r.title : ''}`)].join('\n');
  process.stdout.write(text + '\n', () => process.exit(0));   // the timelines leave timers behind: once written, it is done
} else if (cmd === 'statusline') {
  let raw = ''; const go = () => { let dir = ''; try { const j = JSON.parse(raw); dir = (j.workspace && j.workspace.current_dir) || j.cwd || ''; } catch {} console.log(line(snapshot(dir), true)); process.exit(0); };
  if (process.stdin.isTTY) go(); else { process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => (raw += d)); process.stdin.on('end', go); setTimeout(go, 800); }
} else if (cmd === 'serve') {
  const port = +process.env.PORT || 4747, srv = server.start(port);
  srv.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use (Agent Standup may already be running, e.g. inside your editor). Try: agent-standup --port ${port + 1}` : String(e)); process.exit(1); });
  srv.on('listening', () => { if (flags.open) { const url = `http://localhost:${port}/`, opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]; try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {} } });
  srv.on('listening', () => server.updateInfo().then((u) => { if (u.newer && u.cmd) console.log(`\nAgent Standup ${u.latest} is out (you have ${u.current}). ${u.how === 'plugin' ? 'Update the plugin, then restart Claude Code:' : u.how === 'npx' ? 'Next time, start it with:' : 'Update it with:'}\n  ${u.cmd}\n`); }, () => {}));   // a newer version (server.js, updateInfo: at most one request to npm a day, never with DO_NOT_TRACK or NO_UPDATE_NOTIFIER)
  process.on('SIGINT', () => { try { server.shutdown(); } catch {} process.exit(0); });
} else { console.error(`Unknown command "${cmd}".\n\n${HELP}`); process.exit(2); }
