// test/steps.test.js: the kind of step a call is (steps.js), whether a command runs tests and whose its exit code is, and what a test run came to, from cases seen in real sessions.
const test = require('node:test'), assert = require('node:assert');
const { shellStep, toolStep, testOutcome, runnerExit, looseTests, printedExit } = require('../steps.js');

test('a command line takes the kind of its most serious part', () => {
  const cases = [
    ['cd app && cat x && rm y', 'delete'], ['npm test 2>&1 | tail -20', 'test'], ['npm test > log 2>&1', 'test', 'a test writing its log is a test'], ['echo hi > out.txt', 'write'],
    ['node --check server.js && node --check codex.js', 'test'], ['git add . && git commit -m x', 'git'], ['curl -s http://x | jq .', 'web'], ['sed -i "" s/a/b/ f.js', 'edit'],
    ['npm run build', 'build'], ['npm install', 'build'], ['find . -name "*.tmp" -delete', 'delete'], ['ls -la', 'search'], ['python3 -m pytest -q', 'test'], ['cargo test', 'test'],
    ["python3 - <<'EOF'\nprint(1)\nEOF\nrm -rf dist", 'delete', 'a command after a closed heredoc is read'], ["cat > a.js <<'EOF'\nrm -rf /\nEOF", 'write', 'a heredoc body is data'],
    ['npx -y @vscode/vsce ls', 'run'], ['', ''],
  ];
  for (const [cmd, want, why] of cases) assert.equal(shellStep(cmd).step, want, why || cmd);
  assert.equal(toolStep('Read'), 'read'); assert.equal(toolStep('MultiEdit'), 'edit'); assert.equal(toolStep('Agent'), 'delegate'); assert.equal(toolStep('mcp__Claude_Preview__preview_eval'), 'web'); assert.equal(toolStep('mcp__x__y'), '');
});

test('a test run, and how sure its exit code is the runner\'s own', () => {
  assert.equal(runnerExit('ls'), -1); assert.equal(runnerExit('tsc --noEmit'), -1, 'a type check is a check, not a test run'); assert.equal(runnerExit('eslint src'), -1);
  assert.equal(runnerExit('npm test'), 2); assert.equal(runnerExit('cd x && npm test'), 2); assert.equal(runnerExit('node --test test/a.test.js 2>&1'), 2, 'a redirect is not a later part');
  assert.equal(runnerExit('npm test && git commit -m x'), 1); assert.equal(runnerExit('npm test 2>&1 | tail -5'), 0); assert.equal(runnerExit('npm test; echo done'), 0);
  assert.equal(runnerExit('npm test > log 2>&1; echo "exit $?"'), 3); assert.equal(runnerExit('npm test > log 2>&1; echo "exit $?" >> log'), 0, 'printed into a file, not the output');
  assert.equal(runnerExit('python3 tests/test_social.py'), 2); assert.equal(runnerExit('cat test/a.test.js'), -1, 'reading a test file runs nothing');
  assert.equal(runnerExit("python3 - <<'EOF'\nopen('x').write('npm test')\nEOF\nnode --check a.js"), -1, 'words in a heredoc are data');
  assert.equal(shellStep('npm test | tail').tr, 0); assert.equal(shellStep('git status').tr, undefined);
});

test('counts a run printed without its whole summary, and an exit code it printed', () => {
  assert.deepEqual(looseTests('# pass 22\n# fail 0\n M public/index.html'), { runner: 'node', pass: 22, fail: 0, skip: 0, total: 22, failed: [] });
  assert.deepEqual(looseTests('TAP version 13\nok 1 - a\nnot ok 2 - b\n1..2'), { runner: 'tap', pass: 1, fail: 1, skip: 0, total: 2, failed: ['b'] });
  assert.equal(looseTests('ok 1 file written'), null, 'TAP needs its plan'); assert.equal(looseTests('all good'), null);
  assert.equal(printedExit('built\nexit=0'), 0); assert.equal(printedExit('eslint exit 1\n'), 1); assert.equal(printedExit('EXIT CODE: 2'), 2); assert.equal(printedExit('the exit 0 of grep'), null);
});

test('what a test run came to: its output first, then an exit code that is surely the runner\'s', () => {
  const run = (cmd) => ({ tr: runnerExit(cmd) });
  assert.deepEqual(testOutcome(run('npm test'), null), { st: 'running' });
  const fail = { runner: 'node', pass: 2, fail: 1, skip: 0, total: 3, failed: ['totals'] };
  assert.deepEqual(testOutcome(run('npm test 2>&1 | tail'), { err: false, out: '…', tests: fail }), { st: 'fail', tests: fail, hid: 1 }, 'a failure behind exit 0: only the output says so');
  assert.equal(testOutcome(run('npm test'), { err: true, out: 'Exit code 1\n…', tests: fail }).hid, undefined);
  assert.equal(testOutcome(run('npm test'), { err: true, out: 'Exit code 1\nboom' }).st, 'fail');
  assert.equal(testOutcome(run('npm test && git push'), { err: true, out: 'Exit code 1\n' }).st, 'ran', 'the push may have failed');
  assert.equal(testOutcome(run('npm test && git push'), { err: false, out: '' }).st, 'pass');
  assert.equal(testOutcome(run('npm test | tail -3'), { err: false, out: 'something' }).st, 'ran', 'the exit code is tail\'s');
  assert.equal(testOutcome(run('npm test > log; echo "exit $?"'), { err: false, out: 'exit 1', pexit: 1 }).st, 'fail');
  assert.equal(testOutcome(run('node --test | grep fail'), { err: false, out: '# fail 1', tcount: looseTests('# pass 3\n# fail 1') }).st, 'fail');
  assert.equal(testOutcome({}, { err: false, out: '', tcount: looseTests('# pass 3\n# fail 1') }).st, 'ran', 'loose counts only for a command known to run tests');
  assert.equal(testOutcome(run('npm test'), { err: false, out: 'Command running in background', bg: 'b1' }).st, 'ran');
  assert.equal(testOutcome(run('npm test'), { err: false, out: '', bg: 'b1', bgEnd: { st: 'completed', code: 1 } }).st, 'fail');
  assert.equal(testOutcome(run('npm test'), { err: false, out: '', bg: 'b1', bgEnd: { st: 'completed', code: 0 } }).st, 'pass');
  assert.equal(testOutcome(run('npm test'), { err: false, out: '', bg: 'b1', bgEnd: { st: 'killed' } }).st, 'ran');
});

test('a test runner is the program a part of the line runs, not a word in it; a line that prints its exit code is judged by that code only', () => {
  const steps = require('../steps.js');
  for (const c of ['grep -rn "pytest" .', 'grep -q jest package.json', 'which pytest', 'npm install --save-dev vitest', 'pip install pytest', 'git commit -m "Run mocha in CI"', 'rm -rf node_modules/.cache/jest', 'cat jest.config.js'])
    assert.equal(steps.shellStep(c).tr, undefined, c + ' runs no tests');
  for (const c of ['npm test', 'cd app && npm test', 'CI=1 npx vitest run', 'python -m pytest -q', 'uv run pytest', 'timeout 120 npm test', 'python3 tests/test_cart.py'])
    assert.equal(steps.shellStep(c).tr, 2, c + ' runs tests');
  const out = (res) => steps.testOutcome({ tr: 3 }, res).st;
  assert.equal(out({ bg: 1, bgEnd: { code: 1 } }), 'ran', 'npm test > log; echo "exit=$?"; grep … log: the line ended 1 because of grep, the runner is unknown');
  assert.equal(out({ bg: 1, bgEnd: { code: 0 } }), 'ran', 'nor a pass from grep finding lines');
  assert.equal(out({ err: false, out: '1' }), 'ran', 'echo $? printed 1 without the word exit: not a pass');
  assert.equal(out({ err: false, out: 'exit=0', pexit: 0 }), 'pass');
  assert.equal(out({ err: false, out: 'EXIT=1', pexit: 1 }), 'fail');
});
