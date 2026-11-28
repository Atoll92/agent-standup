'use strict';
// What kind of step a tool call was, named for what it did and not for the tool: read, search, write, edit, delete, run, test, build, git, web, plan or delegate. Claude Code's Read, a `cat` and a
// `head` are all "read"; `cd app && npm test && rm -rf dist` is a delete (a line of several parts takes its most serious one). And whether a command runs a test runner, and if so whether its
// exit code is the runner's own (`npm test`) or could be set by what follows it (`npm test | tail`, `npm test; echo done`).
// The rules for commands are RayTrace's (proxy/call-category.mjs, https://github.com/Godcreatebugs/raytrace-cli, MIT, Copyright (c) 2026 RayTrace contributors), without the model they ask when
// no rule places a command (here such a command is a "run"), and with these changes, made on real sessions: a redirect counts only after a program that prints or reads (`npm test > log` is a test,
// not a write), `node --check` is a test, and a closed heredoc no longer hides the commands written after it. Nothing here reads a file or calls anything: it only reads the call.

const PRIORITY = ['delete', 'edit', 'write', 'git', 'build', 'test', 'web', 'run', 'search', 'read'];
const strongest = (found) => PRIORITY.find((c) => found.has(c)) || '';

const TOOLS = {
  Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', LS: 'search',
  Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  BashOutput: 'run', KillShell: 'run', KillBash: 'run', TaskOutput: 'run', TaskStop: 'run', Monitor: 'run',
  WebFetch: 'web', WebSearch: 'web',
  TodoWrite: 'plan', TodoRead: 'plan', TaskCreate: 'plan', TaskUpdate: 'plan', TaskList: 'plan', TaskGet: 'plan', AskUserQuestion: 'plan', ExitPlanMode: 'plan', EnterPlanMode: 'plan', ToolSearch: 'plan', ScheduleWakeup: 'plan',
  Task: 'delegate', Agent: 'delegate', Skill: 'delegate', SlashCommand: 'delegate', Workflow: 'delegate', SendMessage: 'delegate', SubagentHandback: 'delegate',
  Artifact: 'write', ArtifactData: 'write',
};

const set = (w) => new Set(w.split(' '));
const QUIET = set('cd pushd popd export set unset source . true false : echo printf pwd date whoami id uname hostname sleep wait test [ [[ printenv which type hash alias unalias ulimit umask trap shopt local declare typeset readonly read exit return break continue clear history basename dirname realpath readlink nproc arch uptime tty seq yes getconf for case function select fi done esac } )');
const PREFIX = set('sudo time nice nohup command exec builtin env if then elif else while until do ! { (');
const READ = set('cat head tail less more bat nl wc stat file du df diff cmp md5sum sha1sum sha256sum shasum xxd hexdump od strings jq yq sort uniq cut column tr awk gawk comm paste fold zcat tac rev');
const SEARCH = set('grep egrep fgrep zgrep rg ag ack find fd fdfind ls tree locate exa eza');
const WRITE = set('touch mkdir ln cp rsync install dd mktemp unzip zip gzip gunzip');
const EDIT = set('patch apply_patch ed ex chmod chown chgrp truncate dos2unix isort');
const DELETE = set('rm rmdir unlink shred mv trash');
const TEST = set('pytest py.test tox nox jest vitest mocha ava cypress rspec phpunit oxlint biome tsc mypy pyright pylint flake8 shellcheck ctest stylelint markdownlint hadolint yamllint actionlint');
const BUILD = set('cmake ninja gcc g++ cc clang clang++ rustc javac swiftc ld webpack rollup esbuild pipx');
const GIT = set('gh hub svn hg');
const WEB = set('curl wget http https ssh scp sftp nc ncat netcat ping dig nslookup host telnet ftp traceroute whois');
const RUN = set('node deno ruby php lua Rscript java tsx ts-node swift open xdg-open kill pkill killall watch screen tmux osascript expect');
const SHELLS = set('sh bash zsh dash fish ksh');
const PYTHON = /^(python[\d.]*|py)$/;
const INSTALLERS = set('apt apt-get brew yum dnf apk pacman conda mamba gem composer');
const INSTALL_VERBS = set('install i ci add remove uninstall rm update upgrade up rebuild link dedupe prune sync lock create require');
const SCRIPT_PATH = /\/|\.(sh|bash|py|js|mjs|cjs|ts|rb|pl|php)$/;

function scriptCategory(name) {   // a package script or a make target, by its name
  if (/^(test|tests|spec|e2e|lint|typecheck|type-check|check|verify|tsc|ci|format:check|fmt:check)\b/i.test(name)) return 'test';
  if (/^(lint:fix|format|fmt|fix)\b/i.test(name)) return 'edit';
  if (/^(build|compile|bundle|dist|prepare|generate|codegen|all|install|release|package)\b/i.test(name)) return 'build';
  if (/^(start|dev|serve|preview|watch|run)\b/i.test(name)) return 'run';
  if (/^(clean|distclean)\b/i.test(name)) return 'delete';
  return null;
}

const VAGUE = 1, QUIETLY = 2;
const has = (args, ...flags) => args.some((a) => flags.includes(a));
const firstPlain = (args) => args.find((a) => !a.startsWith('-') && !/^\w+=/.test(a));
const afterPlain = (args) => { const i = args.findIndex((a) => !a.startsWith('-') && !/^\w+=/.test(a)); return i < 0 ? [] : args.slice(i + 1); };
const shellWords = (t) => [...t.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

function programCategory(words) {   // one program with its arguments: a step, VAGUE, QUIETLY, or what the command it wraps does (`bash -c`, `npx`, `find -exec`)
  const list = [...words];
  for (let guard = 0; guard < 64; guard++) {   // past `sudo`, `FOO=bar`, `timeout 30`, `if`, `xargs -n 1` to the real program
    const w = list[0];
    if (w === undefined) return QUIETLY;
    if (/^\w+=/.test(w)) { list.shift(); continue; }
    if (w === 'command' && /^-[vV]$/.test(list[1] || '')) return QUIETLY;
    if (PREFIX.has(w)) { list.shift(); continue; }
    if (w === 'timeout' || w === 'gtimeout') { list.splice(0, /^\d/.test(list[1] || '') ? 2 : 1); continue; }
    if (w === 'xargs') { list.shift(); while (list[0] && list[0].startsWith('-')) list.splice(0, /^-[InLPdEs]$/.test(list[0]) ? 2 : 1); if (!list.length) return QUIETLY; continue; }
    break;
  }
  if (!list.length) return QUIETLY;
  const program = list[0].replace(/^[({!]+|[)}]+$/g, '').split('/').pop(), args = list.slice(1), sub = firstPlain(args);
  if (!program || QUIET.has(program)) return QUIETLY;
  if (args.length === 1 && has(args, '--version', '--help')) return QUIETLY;   // a program asked about itself
  if (SHELLS.has(program)) { const i = args.findIndex((a) => /^-\w*c$/.test(a)); return i >= 0 && args[i + 1] ? shellResult(args[i + 1]) : 'run'; }
  if (program === 'eval') return args.length ? shellResult(args.join(' ')) : QUIETLY;
  if (PYTHON.test(program)) {
    const f = args.indexOf('-m'), name = args[f + 1];
    if (f < 0 || !name) return 'run';
    const inner = programCategory([name, ...args.slice(f + 2)]);
    return inner === VAGUE || inner === QUIETLY ? (name === 'unittest' ? 'test' : name === 'venv' ? 'build' : 'run') : inner;
  }
  if (['npx', 'bunx', 'pnpx', 'uvx'].includes(program)) { const rest = [...args]; while (rest[0] && rest[0].startsWith('-')) rest.splice(0, /^(-p|--package)$/.test(rest[0]) ? 2 : 1); return rest.length ? programCategory(rest) : VAGUE; }
  if (program === 'git') return ['grep', 'ls-files', 'ls-tree'].includes(sub) ? 'search' : 'git';
  if (GIT.has(program)) return 'git';
  if (program === 'find' || program === 'fd' || program === 'fdfind') {
    if (has(args, '-delete')) return 'delete';
    const e = args.findIndex((a) => /^-(exec|execdir|ok|x|X)$/.test(a));
    if (e >= 0 && args[e + 1]) { const inner = programCategory(args.slice(e + 1)); return inner === QUIETLY ? 'search' : inner; }
    return 'search';
  }
  if (program === 'sed') return args.some((a) => /^(-i|--in-place)/.test(a) || /^-[a-zA-Z]*i/.test(a)) ? 'edit' : 'read';
  if (program === 'perl') return args.some((a) => /^-[a-zA-Z]*i/.test(a)) ? 'edit' : 'run';
  if (program === 'tee') return has(args, '-a', '--append') ? 'edit' : 'write';
  if (program === 'tar') return /t/.test((args[0] || '').replace(/^--?/, '')) && !/[xc]/.test(args[0] || '') ? 'read' : 'write';
  if (program === 'prettier') return has(args, '--write', '-w') ? 'edit' : 'test';
  if (program === 'eslint') return has(args, '--fix') ? 'edit' : 'test';
  if (program === 'black' || program === 'rustfmt') return has(args, '--check', '--diff') ? 'test' : 'edit';
  if (program === 'gofmt') return has(args, '-w') ? 'edit' : 'test';
  if (program === 'ruff') return sub === 'format' ? (has(args, '--check', '--diff') ? 'test' : 'edit') : has(args, '--fix') ? 'edit' : 'test';
  if (program === 'playwright') return sub === 'test' ? 'test' : sub === 'install' ? 'build' : VAGUE;
  if (program === 'node') return has(args, '--test', '--check', '-c') ? 'test' : 'run';
  if (program === 'deno') return ['test', 'lint', 'check'].includes(sub) ? 'test' : sub === 'fmt' ? 'edit' : sub === 'install' ? 'build' : 'run';
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    if (!sub) return program === 'yarn' ? 'build' : VAGUE;
    if (sub === 'test' || sub === 't') return 'test';
    if (sub === 'start') return 'run';
    if (sub === 'run' || sub === 'run-script') { const name = firstPlain(afterPlain(args)); return (name && (scriptCategory(name) || (SCRIPT_PATH.test(name) ? 'run' : null))) || VAGUE; }
    if (['exec', 'dlx', 'x'].includes(sub)) { const rest = afterPlain(args); return rest.length ? programCategory(rest) : VAGUE; }
    if (sub === 'pack' || sub === 'publish') return 'build';
    if (INSTALL_VERBS.has(sub)) return 'build';
    if (program === 'bun' && SCRIPT_PATH.test(sub)) return 'run';
    return program === 'npm' ? VAGUE : scriptCategory(sub) || VAGUE;   // yarn, pnpm and bun run a package script named without `run`
  }
  if (program === 'pip' || program === 'pip3') return ['install', 'uninstall', 'download', 'wheel'].includes(sub) ? 'build' : ['list', 'show', 'freeze'].includes(sub) ? 'read' : VAGUE;
  if (['uv', 'poetry', 'pdm', 'bundle'].includes(program)) {
    if (sub === 'run' || sub === 'exec') { const rest = afterPlain(args); return rest.length ? programCategory(rest) : VAGUE; }
    return INSTALL_VERBS.has(sub) || ['pip', 'venv', 'build'].includes(sub) ? 'build' : VAGUE;
  }
  if (INSTALLERS.has(program)) return INSTALL_VERBS.has(sub) ? 'build' : ['list', 'search', 'info', 'show'].includes(sub) ? 'search' : VAGUE;
  if (program === 'cargo') {
    if (['test', 'clippy', 'check', 'bench'].includes(sub)) return 'test';
    if (sub === 'fmt') return has(args, '--check') ? 'test' : 'edit';
    if (['build', 'install', 'add', 'remove', 'fetch', 'update', 'doc'].includes(sub)) return 'build';
    return sub === 'run' ? 'run' : VAGUE;
  }
  if (program === 'go') {
    if (sub === 'test' || sub === 'vet') return 'test';
    if (['build', 'install', 'get', 'mod', 'generate'].includes(sub)) return 'build';
    return sub === 'run' ? 'run' : sub === 'fmt' ? 'edit' : VAGUE;
  }
  if (['mvn', 'mvnw', 'gradle', 'gradlew'].includes(program)) return ['test', 'verify', 'check'].includes(sub) ? 'test' : 'build';
  if (program === 'dotnet') return sub === 'test' ? 'test' : ['build', 'restore', 'publish', 'add'].includes(sub) ? 'build' : sub === 'run' ? 'run' : VAGUE;
  if (program === 'vite' || program === 'next') return sub === 'build' ? 'build' : sub === 'lint' ? 'test' : 'run';
  if (['make', 'gmake', 'just', 'task'].includes(program)) return sub ? scriptCategory(sub) || VAGUE : 'build';
  if (['docker', 'podman', 'docker-compose'].includes(program)) {
    const verb = sub === 'compose' ? firstPlain(afterPlain(args)) : sub;
    if (['build', 'buildx', 'pull'].includes(verb)) return 'build';
    if (['run', 'exec', 'start', 'up'].includes(verb)) return 'run';
    if (['push', 'login'].includes(verb)) return 'web';
    return ['rm', 'rmi', 'prune', 'down'].includes(verb) ? 'delete' : VAGUE;
  }
  for (const [c, programs] of [['read', READ], ['search', SEARCH], ['write', WRITE], ['edit', EDIT], ['delete', DELETE], ['test', TEST], ['build', BUILD], ['web', WEB], ['run', RUN]]) if (programs.has(program)) return c;
  return SCRIPT_PATH.test(list[0]) ? 'run' : VAGUE;
}

const maskQuotes = (t) => t.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, (q) => q[0] + 'x'.repeat(q.length - 2) + q[0]);
// A heredoc's body is data, not commands: only the line that opens it is kept (its << turned into ‹‹, so that the pass for a heredoc cut off before its end does not take it for one).
const withoutHeredocs = (t) => t.replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, (m, opener) => opener.replace('<<', '‹‹')).replace(/(<<-?\s*(['"]?)\w+\2[^\n]*)\n[\s\S]*$/, '$1');

function partsOf(line) {   // the line's parts: split at && || ; | & and newlines, outside quotes
  const masked = maskQuotes(line), parts = [];
  let start = 0;
  const cut = (end, skip) => { if (line.slice(start, end).trim()) parts.push(line.slice(start, end).trim()); start = end + skip; };
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i], two = masked.slice(i, i + 2);
    if (ch === '\\') { i++; continue; }
    if (two === '&&' || two === '||' || two === '$(') { cut(i, 2); i++; continue; }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '`') { cut(i, 1); continue; }
    if (ch === '&' && masked[i - 1] !== '>' && masked[i + 1] !== '>') cut(i, 1);   // a lone & backgrounds a command; next to > it is part of a redirect
  }
  cut(masked.length, 0);
  return parts;
}
function redirectCategory(part) {   // `> file` writes, `>> file` appends; standard error, another descriptor and /dev/* are not files being written
  for (const m of maskQuotes(part).matchAll(/(^|[^>&=\-\d])(>>|>\|?)(?![>&])\s*([^\s;&|<>]+)/g)) { if (m[3].startsWith('/dev/')) continue; return m[2] === '>>' ? 'edit' : 'write'; }
  return null;
}
function withoutRedirects(part) {
  let t = part;
  for (const m of [...maskQuotes(part).matchAll(/[&\d]?(?:>>|>\||>|<<-?|<)&?\s*[^\s;&|<>]*/g)].reverse()) t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
  return t;
}
function shellParts(command) {
  const found = new Set(); let vague = 0, programs = 0;
  for (const part of partsOf(withoutHeredocs(command))) {
    programs++;
    const res = programCategory(shellWords(withoutRedirects(part)));
    const r = redirectCategory(part); if (r && (res === QUIETLY || res === 'read')) found.add(r);
    if (res === QUIETLY) continue;
    if (res === VAGUE) vague++;
    else if (typeof res === 'string') found.add(res);
    else { for (const c of res.found) found.add(c); vague += res.vague; }
  }
  return { found, vague, programs };
}
function shellResult(command) {
  const r = shellParts(command);
  if (!r.found.size && !r.vague) return r.programs ? 'run' : QUIETLY;
  return r;
}

// A test runner, and the scripts named as tests that an interpreter runs (python3 tests/test_cart.py, node test/cart.test.js). Linters and type checkers are "test" steps too, but not test runs.
const RUNNER = /\b(?:npm (?:run )?test|yarn test|pnpm test|bun test|deno test|node (?:--\S+ )*--test|pytest|py\.test|jest|vitest|mocha|cargo test|go test|rspec|phpunit|playwright test|make test|tox)\b|\b(?:node|python[\d.]*|tsx|bun|php)\s+(?:-\S+\s+)*\S*(?:tests?\/|test_|[._-]test\.|_test\.|\.spec\.)\S*/;
/** How sure the exit code of a command line is the test runner's own: 2 when nothing follows the runner, 1 when only `&&` does (a success is everyone's, a failure may be a later part's),
 *  3 when the line prints it right after (`npm test > log; echo "exit $?"`), 0 otherwise; -1: no test runner. */
const RUNS = new RegExp('^(?:[A-Za-z_]\\w*=\\S*\\s+)*(?:(?:npx|pnpx|bunx|time|exec|env|nice|(?:uv|poetry|pipenv|pdm|hatch) run|timeout\\s+\\S+|python[\\d.]*\\s+-m)\\s+(?:-\\S+\\s+)*)*(?:' + RUNNER.source + ')');   // the part starts with the runner, after a few launchers and VAR=value
function runnerExit(command) {
  const raw = withoutHeredocs(command); if (!partsOf(raw).some((p) => RUNS.test(p))) return -1;
  const m0 = raw.match(RUNNER); if (!m0) return -1;
  const after = raw.slice(m0.index + m0[0].length).replace(/\d?>&\d|&>/g, ' ').replace(/^[^;&|\n]*/, '');   // what follows the runner's own part (its arguments and redirects: the & of 2>&1 is not a separator)
  if (/^\s*(?:;|\n|&&)\s*echo\b[^;&|\n>]*\$\?[^;&|\n>]*(?:$|[;&|\n])/.test(after)) return 3;   // printed to the output, not into a file
  const c = raw.replace(/\d?>&\d|&>\s*\S*|\d?>>?\s*\S+/g, ' '), m = c.match(RUNNER);
  if (!m) return 0;
  const rest = maskQuotes(c.slice(m.index + m[0].length));
  if (!/[|;&\n]/.test(rest)) return 2;
  return /\|(?!\|)|;|\n|\|\||(?<!&)&(?!&)/.test(rest) ? 0 : 1;
}
/** Counts a test run printed without its whole summary (a `grep` kept only "# pass" and "# fail"; TAP lines with no totals), read only for a command known to run tests:
 *  { runner, pass, fail, skip, total, failed } or null. testsOf in server.js reads the whole summaries of every runner, for any command. */
function looseTests(text0) {
  let s = String(text0 || ''); if (s.length > 400000) s = s.slice(-400000);
  const last = (re) => { let x = null; for (const m of s.matchAll(re)) x = m; return x; }, failed = [];
  const f = last(/^(?:#|ℹ) fail (\d+)[ \t]*$/gm), p = last(/^(?:#|ℹ) pass (\d+)[ \t]*$/gm);
  for (const m of s.matchAll(/^not ok \d+ - (.{1,120}?)(?:[ \t]+#.*)?[ \t]*$/gm)) if (failed.length < 6 && !failed.includes(m[1])) failed.push(m[1]);
  if (f || p) { const pass = p ? +p[1] : 0, fail = f ? +f[1] : 0; return { runner: 'node', pass, fail, skip: 0, total: pass + fail, failed }; }
  const ok = (s.match(/^ok \d+\b/gm) || []).length, no = (s.match(/^not ok \d+\b/gm) || []).length;
  if ((ok || no) && /^1\.\.\d+[ \t]*$/m.test(s)) return { runner: 'tap', pass: ok, fail: no, skip: 0, total: ok + no, failed };
  return null;
}
/** An exit code a command printed on a line of its own (`exit=0`, `exit 1`, `EXIT CODE: 2`), the last one; null when there is none. */
function printedExit(text0) {
  let x = null; for (const m of String(text0 || '').slice(-200000).matchAll(/^[ \t]*(?:[\w-]+[ \t]+)?exit(?:[ \t]*code)?[ \t]*[=:]?[ \t]*(-?\d{1,3})[ \t]*$/gim)) x = +m[1];
  return x;
}

/** A shell command line's step ('' when there is none) and, when it runs tests, tr: runnerExit. */
function shellStep(command) {
  const cmd = String(command || ''), r = shellParts(cmd), out = { step: r.found.has('delete') ? 'delete' : strongest(r.found) || (r.programs ? 'run' : '') };
  const tr = runnerExit(cmd); if (tr >= 0) out.tr = tr;
  return out;
}
/** A tool's step by its name, '' when nothing here knows it. */
function toolStep(name) {
  const tool = String(name || '');
  if (Object.prototype.hasOwnProperty.call(TOOLS, tool)) return TOOLS[tool];
  if (/^mcp__(claude-in-chrome|Claude_in_Chrome|Claude_Preview|Claude_Browser)__/.test(tool)) return 'web';
  return '';
}

/** What one test run came to: { st: pass | fail | ran | running, tests?, hid? }. call: its tool (tr), res: its result ({ err, out, tests, tcount, pexit, bg, bgEnd }), or nothing yet.
 *  The runner's own summary first, then its exit code where the line leaves no doubt it is the runner's. hid: failures behind an exit code of 0 (a pipe into tail or grep): only the output says so.
 *  A copy of testVerdict in public/index.html: keep the two in step. */
function testOutcome(call, res) {
  if (!res) return { st: 'running' };
  const tr = call && call.tr, t = res.tests || (tr >= 0 && res.tcount) || null;
  if (t) return { st: t.fail ? 'fail' : 'pass', tests: t, ...(t.fail && !res.err && !res.bg ? { hid: 1 } : {}) };
  let code;
  if (tr === 3) { if (res.pexit == null) return { st: 'ran' }; code = res.pexit; }   // `npm test > log; echo $?; grep … log`: the line's exit code is the last command's, not the runner's
  else if (res.bg) { if (!res.bgEnd || res.bgEnd.code == null) return { st: 'ran' }; code = res.bgEnd.code; }
  else { const m = /^(?:Exit code|Process exited with code) (-?\d+)/.exec(String(res.out || '')); code = res.err ? (m ? +m[1] : null) : 0; if (code == null) return { st: 'ran' }; }
  if (code !== 0) return tr === 2 || tr === 3 ? { st: 'fail' } : { st: 'ran' };
  return tr >= 1 ? { st: 'pass' } : { st: 'ran' };
}

module.exports = { shellStep, toolStep, testOutcome, runnerExit, looseTests, printedExit };
