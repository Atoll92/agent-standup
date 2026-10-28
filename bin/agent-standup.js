#!/usr/bin/env node
// Agent Standup from a terminal: the live call in your browser, and one-line status for status bars (Claude Code, tmux, Neovim…).
//   agent-standup [serve] [--port 4747] [--open]   start the local server and (optionally) open the page
//   agent-standup status [--here] [--json] [--titles]  counts of working / needs you / your turn
//   agent-standup statusline                        same, one short line; reads Claude Code's statusLine JSON on stdin
// Everything reads the local session files Claude Code already writes. Nothing is sent anywhere unless the call is in French, Spanish or Brazilian Portuguese or you turn on the jokes (they use your own Claude login or ANTHROPIC_API_KEY).
const path = require('path'), { spawn } = require('child_process');
const pkg = require('../package.json');
const argv = process.argv.slice(2), flags = {}, rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--port') flags.port = val(); else if (a === '--projects') flags.projects = val(); else if (a === '--codex') flags.codex = val(); else if (a === '--vibe') flags.vibe = val(); else if (a === '--cowork') flags.cowork = val(); else if (a === '--characters') flags.characters = val(); else if (a === '--config-dir') flags.config = val();
  else if (a === '--reply') flags.reply = /^(0|1|on|off|yes|no|true|false)$/i.test(argv[i + 1] || '') ? val() : 'on';   // alone or followed by on / off
  else if (a === '--from') flags.from = val(); else if (a === '--open') flags.open = true; else if (a === '--here') flags.here = true; else if (a === '--json') flags.json = true; else if (a === '--titles') flags.titles = true; else if (a === '--config') flags.config = val();
  else if (a === '-h' || a === '--help') flags.help = true; else if (a === '-v' || a === '--version') flags.version = true; else rest.push(a);
}
const cmd = rest[0] || 'serve';
const HELP = `Agent Standup ${pkg.version} — your Claude Code, Codex and Mistral Vibe agents as a live video call

Usage
  agent-standup [serve] [--port 4747] [--open]   start the local server (http://localhost:4747)
  agent-standup status [--here] [--json]          what is going on right now (--here: only the current folder)
  agent-standup statusline                        one short line for a status bar (reads Claude Code's JSON on stdin)

Options
  --port N          port of the local server (default 4747)
  --open            open the page in your browser
  --projects DIR    where the session files are (default ~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects); when it is
                    named projects, the sessions folder beside it is read too (what waits for you)
  --config DIR      Claude Code's config folder, as CLAUDE_CONFIG_DIR (its projects and sessions folders are read)
  --codex DIR       where Codex keeps its files (default ~/.codex, or $CODEX_HOME); "off" to leave Codex sessions out
  --vibe DIR        where Mistral Vibe keeps its files (default ~/.vibe, or $VIBE_HOME); "off" to leave Vibe sessions out
  --cowork DIR      where the Claude desktop app keeps its Cowork sessions (default: its local-agent-mode-sessions folder); "off" to leave them out
  --reply           let the call type into the followed Claude Code session's tmux pane (Linux, off by default; anyone who can run commands as you can then type into your sessions)
  --characters DIR  folder with your own pixel-art characters (default ~/.agent-standup/characters)
  --from plugin     how the Claude Code plugin starts it (its usage, if you agree to share it, is counted apart); also AGENT_STANDUP_FROM=plugin,
                    which older versions ignore instead of refusing
  --here            status: only sessions of the current folder (matched on its real path, as Claude Code names it)
  --json            status: machine-readable output
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
if (flags.config) process.env.CLAUDE_CONFIG_DIR = path.resolve(flags.config);
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

if (cmd === 'status') {
  const s = snapshot(flags.here ? process.cwd() : '');
  if (flags.json) console.log(JSON.stringify({ needsYou: s.needsYou, working: s.working, yourTurn: s.yourTurn, idle: s.idle, sessions: s.rows.map((r) => ({ project: r.proj, id: r.id, state: r.state, tool: r.tool, ageMs: Math.round(r.ageMs), subAgentsActive: r.subActive, subAgents: r.subTotal, ...(r.since ? { since: r.since } : {}), ...(r.ran ? { ran: r.ran } : {}), ...(r.limit ? { limit: r.limit } : {}), ...(r.auth ? { auth: 1 } : {}), ...(flags.titles ? { title: r.title, ...(r.ask ? { ask: r.ask } : {}), ...(r.menu && r.menu.about ? { about: r.menu.about } : {}), ...(r.gave ? { gave: r.gave } : {}) } : {}) })) }, null, 2));   // since: when it started to wait, ran: how long it worked before · with --titles only, what the sessions say (it can hold a path, a command or a secret): ask, the question or command that waits for you, about, what that command is for, gave, the error it stopped on
  else console.log(line(s, false));
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
