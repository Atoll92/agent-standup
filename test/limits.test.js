'use strict';
// Plan limits (limits.js): read from the status line's saved copy, Claude Code's own cached copy and Codex's session files; old or reset windows are left out.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
delete process.env.AGENT_STANDUP_LIMITS;
const limits = require('../limits.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'as-limits-'));
const NOW = Date.parse('2026-11-21T12:00:00Z'), H = 3600e3, sec = (ms) => Math.floor(ms / 1000);

test('the status line saves rate_limits and the call reads them back', () => {
  const dir = tmp(), none = path.join(dir, 'no-claude.json');
  assert.equal(limits.save(dir, { cwd: '/x' }), false, 'nothing to save without rate_limits');
  assert.equal(fs.existsSync(path.join(dir, 'limits.json')), false);
  const resets5 = Date.now() + 2 * H, resetsW = Date.now() + 50 * H;
  assert.equal(limits.save(dir, { rate_limits: { five_hour: { used_percentage: 34.4, resets_at: sec(resets5) }, seven_day: { used_percentage: 61, resets_at: sec(resetsW) } } }), true);
  assert.equal(limits.save(dir, { rate_limits: { five_hour: { used_percentage: 34.4, resets_at: sec(resets5) }, seven_day: { used_percentage: 61, resets_at: sec(resetsW) } } }), false, 'the same values within a minute are not written again');
  const r = limits.claude(dir, Date.now(), none);
  assert.equal(r.src, 'statusline');
  assert.deepEqual(r.windows.map((w) => [w.key, w.pct]), [['5h', 34], ['week', 61]]);
  assert.equal(r.windows[0].resetsAt, sec(resets5) * 1000);
});

test("Claude Code's cached copy is used when it is the freshest, and a window that reset is dropped", () => {
  const dir = tmp(), file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: 'x' }, cachedUsageUtilization: { fetchedAtMs: NOW - H, utilization: {
    five_hour: { utilization: 4, resets_at: new Date(NOW - 60e3).toISOString() },   // already reset
    seven_day: { utilization: 33, resets_at: new Date(NOW + 20 * H).toISOString() } } } }));
  const r = limits.claude(dir, NOW, file);
  assert.equal(r.src, 'claude');
  assert.deepEqual(r.windows.map((w) => [w.key, w.pct]), [['week', 33]]);
  assert.equal(r.asOf, NOW - H);
  // a newer status-line copy wins over it
  fs.writeFileSync(path.join(dir, 'limits.json'), JSON.stringify({ at: NOW - 60e3, rate_limits: { seven_day: { used_percentage: 40, resets_at: sec(NOW + 20 * H) } } }));
  assert.equal(limits.claude(dir, NOW, file).src, 'statusline');
  assert.equal(limits.claude(dir, NOW, file).windows[0].pct, 40);
});

test('a reading older than twelve hours says nothing', () => {
  const dir = tmp(), file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: NOW - limits.STALE - 1, utilization: { seven_day: { utilization: 33, resets_at: new Date(NOW + 20 * H).toISOString() } } } }));
  assert.equal(limits.claude(dir, NOW, file), null);
  assert.equal(limits.claude(dir, NOW, path.join(dir, 'missing.json')), null);
  fs.writeFileSync(file, '{ not json');
  assert.equal(limits.claude(dir, NOW, file), null);
});

test("Codex: the last rate_limits of the newest session file, in both of Codex's formats", () => {
  const dir = tmp(), f1 = path.join(dir, 'a.jsonl'), f2 = path.join(dir, 'b.jsonl');
  const rec = (ts, rl) => JSON.stringify({ timestamp: new Date(ts).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });
  fs.writeFileSync(f1, [
    rec(NOW - 2 * H, { primary: { used_percent: 10, window_minutes: 300, resets_at: sec(NOW + H) } }),
    rec(NOW - H, { primary: { used_percent: 22.6, window_minutes: 300, resets_at: sec(NOW + H) }, secondary: { used_percent: 48, window_minutes: 10080, resets_at: sec(NOW + 90 * H) } }),
    JSON.stringify({ timestamp: new Date(NOW - 30e3).toISOString(), type: 'response_item', payload: { type: 'message' } }), ''].join('\n'));
  const r = limits.codex([{ file: f1 }], NOW);
  assert.equal(r.src, 'codex');
  assert.deepEqual(r.windows.map((w) => [w.key, w.pct]), [['5h', 23], ['week', 48]]);
  assert.equal(r.asOf, NOW - H);
  // the older form: resets_in_seconds, counted from the record's time; a compressed file is skipped
  fs.writeFileSync(f2, rec(NOW - 60e3, { primary: { used_percent: 5, window_minutes: 43200, resets_in_seconds: 3600 }, secondary: null }) + '\n');
  const r2 = limits.codex([{ file: path.join(dir, 'gone.jsonl.zst'), zst: true }, { file: f2 }, { file: f1 }], NOW);
  assert.deepEqual(r2.windows.map((w) => [w.key, w.pct, w.resetsAt]), [['month', 5, NOW - 60e3 + 3600e3]]);
  assert.equal(limits.codex([], NOW), null);
});

test('window lengths get short names', () => {
  assert.deepEqual([300, 10080, 43200, 120, 2880, 0].map(limits.keyOfMinutes), ['5h', 'week', 'month', '2h', '2d', '']);
});
