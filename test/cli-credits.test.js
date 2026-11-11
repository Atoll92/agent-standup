// test/cli-credits.test.js: `agent-standup credits`, the line the plugin's credits skill puts in a pull request: who was on the call, named as the call names them, and what they did
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-credits-'));
const at = (min) => new Date(Date.UTC(2026, 0, 1, 9, min)).toISOString(), line = (o) => JSON.stringify(o) + '\n';
const said = (m, text) => ({ type: 'assistant', timestamp: at(m), message: { id: 'm' + m, stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const used = (m, id, name, input) => ({ type: 'assistant', timestamp: at(m), message: { id: 'u' + m + id, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const typed = (m, content) => ({ type: 'user', timestamp: at(m), message: { role: 'user', content } }), result = (m, id, content) => typed(m, [{ type: 'tool_result', tool_use_id: id, content }]);
const dir = path.join(tmp, 'projects', '-work-shop');
fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
fs.writeFileSync(path.join(dir, 's1.jsonl'), [typed(0, 'Fix the cart'), used(1, 't1', 'Bash', { command: 'npm test' }), result(2, 't1', 'ok'),
  used(3, 'ta', 'Agent', { prompt: 'Find the slow query.', description: 'Profiler' }), used(3, 'tb', 'Agent', { prompt: 'Write the test.', description: 'Tests' }),
  result(6, 'ta', 'Found it.'), result(7, 'tb', 'Written.'), used(8, 't2', 'Edit', { file_path: '/work/shop/cart.js', old_string: 'a', new_string: 'b' }), result(9, 't2', 'ok'), said(10, 'Done.')].map(line).join(''));
for (const [a, tu, m] of [['a1', 'ta', 4], ['a2', 'tb', 4]]) {
  fs.writeFileSync(path.join(dir, 's1', 'subagents', `agent-${a}.jsonl`), [typed(m, 'go'), used(m + 1, 'x' + a, 'Bash', { command: 'ls' }), said(m + 2, 'ok')].map(line).join(''));
  fs.writeFileSync(path.join(dir, 's1', 'subagents', `agent-${a}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: a === 'a1' ? 'Profiler' : 'Tests', toolUseId: tu }));
}
const prefs = path.join(tmp, 'prefs.json');
const run = (args, env = {}) => spawnSync(process.execPath, [path.join(root, 'bin', 'agent-standup.js'), 'credits', ...args], { encoding: 'utf8', cwd: tmp,
  env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', AGENT_STANDUP_LEAD_NAME: '', AGENT_STANDUP_PROJECTS: path.join(tmp, 'projects'), AGENT_STANDUP_CC_SESSIONS: path.join(tmp, 'sessions'), AGENT_STANDUP_PREFS: prefs, AGENT_STANDUP_CODEX: '0', AGENT_STANDUP_VIBE: '0', AGENT_STANDUP_COWORK: 'off', ...env } });

test('the names the credits give are drawn from the same list as the call', () => {
  const page = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), cli = fs.readFileSync(path.join(root, 'bin', 'agent-standup.js'), 'utf8'), list = (s) => /const NAMES = (\[[^\]]*\])/.exec(s)[1];
  assert.equal(list(cli), list(page));
});

test('the session it runs in is credited: the lead, each sub-agent by its name in the call, the work and the calls', () => {
  fs.writeFileSync(prefs, JSON.stringify({ leadName: 'Ada' }));
  const r = run(['--json'], { CLAUDE_CODE_SESSION_ID: 's1' }); assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  assert.equal(c.lead, 'Ada'); assert.equal(c.subAgents.length, 2); assert.ok(!c.subAgents.includes('Ada'), 'never the lead\'s own name'); assert.notEqual(c.subAgents[0], c.subAgents[1]);
  assert.deepEqual([c.commands, c.edits, c.filesChanged], [3, 1, 1]); assert.ok(c.workMin >= 9, 'the minutes between its events');
  assert.match(c.markdown, /^<sub><a href="https:\/\/agent-standup\.com"><img src="https:\/\/agent-standup\.com\/brand\/team-strip\.svg"/);
  assert.match(c.markdown, new RegExp(`call by Ada, ${c.subAgents[0]} and ${c.subAgents[1]} · \\d+m of work · 3 commands · 1 edit in 1 file</sub>$`));
  assert.match(c.text, /^Built on an Agent Standup call by Ada, .* · https:\/\/agent-standup\.com$/);
  assert.equal(run(['--session', 's1']).stdout.trim(), c.markdown, 'the Markdown line by default');
});

test('a name with Markdown or HTML in it stays plain text in the line', () => {
  fs.writeFileSync(prefs, JSON.stringify({ leadName: 'Bo*b_ <img src=x>', subNames: 'Q[a](b), Kim' }));
  const c = JSON.parse(run(['--session', 's1', '--json']).stdout);
  assert.ok(!c.markdown.includes('<img src=x'), c.markdown);
  assert.match(c.markdown, /call by Bo\\\*b\\_ img src=x, Q\\\[a\\\]\(b\) and Kim/);
});

test('without a session to credit it says so', () => {
  const r = run([]); assert.equal(r.status, 2); assert.match(r.stderr, /No session to credit/);
  const n = run(['--session', 'nope']); assert.equal(n.status, 1); assert.match(n.stderr, /No session nope/);
});
