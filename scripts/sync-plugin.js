// Keeps the Claude Code plugins (plugin/, and the band in plugin-band/) at the app's version: their manifests, and the exact npm version the skills and the README run.
// The version is pinned because Anthropic's plugin directory refuses a package run through npx without an exact version.
//   node scripts/sync-plugin.js            writes what is behind
//   node scripts/sync-plugin.js --check    changes nothing, exits 1 when something is behind (CI)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, check = process.argv.includes('--check');
const files = ['plugin/.claude-plugin/plugin.json', 'plugin-band/.claude-plugin/plugin.json', 'plugin/README.md', 'plugin/skills/open/SKILL.md', 'plugin/skills/status/SKILL.md'], behind = [];
for (const rel of files) {
  const f = path.join(root, rel), was = fs.readFileSync(f, 'utf8');
  const now = rel.endsWith('plugin.json') ? was.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`) : was.replace(/(@double_geste\/agent-standup@)\d+\.\d+\.\d+/g, `$1${version}`);
  if (!rel.endsWith('plugin.json') && /npx\s+(-y\s+)?@double_geste\/agent-standup(?!@\d)/.test(now)) { console.error(rel + ': an npx line without an exact version'); process.exit(1); }
  if (now !== was) { behind.push(rel); if (!check) fs.writeFileSync(f, now); }
}
if (check && behind.length) { console.error(`the plugin is not at ${version}: ${behind.join(', ')} (run: node scripts/sync-plugin.js)`); process.exit(1); }
console.log(behind.length ? `plugin set to ${version}: ${behind.join(', ')}` : `plugin is at ${version}`);
