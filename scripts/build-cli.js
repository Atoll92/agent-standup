// Stages the npm package (the `agent-standup` command, no editor needed) in dist-cli/ from the same sources as the VS Code extension.
//   node scripts/build-cli.js            → dist-cli/ (then: cd dist-cli && npm pack      or      npm publish --access public)
// The extension keeps the name "agent-standup" (its Marketplace identity); the npm package is scoped because the unscoped npm name belongs to another project.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist-cli'), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const NAME = process.env.CLI_PACKAGE_NAME || '@double_geste/agent-standup';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const cp = (rel) => fs.cpSync(path.join(root, rel), path.join(out, rel), { recursive: true });
['server.js', 'codex.js', 'kokoro.js', 'kokoro-worker.js', 'demo.js', 'LICENSE', 'public', 'bin', 'examples/cats'].forEach(cp);   // the cat pack ships with the command too
fs.mkdirSync(path.join(out, 'media'), { recursive: true }); fs.copyFileSync(path.join(root, 'media/icon.png'), path.join(out, 'media/icon.png'));
const cli = {
  name: NAME, version: pkg.version, description: 'Your Claude Code agents as a live video call, from the terminal: a local page in your browser, plus one-line status for status bars. Free, open source, zero token cost.',
  bin: { 'agent-standup': 'bin/agent-standup.js' }, main: 'server.js', files: ['bin', 'server.js', 'codex.js', 'kokoro.js', 'kokoro-worker.js', 'demo.js', 'public', 'examples', 'media', 'LICENSE', 'README.md'], license: 'MIT',
  engines: { node: '>=18' }, repository: { type: 'git', url: String(pkg.repository.url).replace(/^(git\+)?/, 'git+') }, homepage: pkg.homepage, bugs: pkg.bugs, keywords: ['claude-code', 'claude', 'agents', 'sub-agents', 'monitoring', 'viewer', 'statusline', 'standup'],
  author: 'Double Geste', publishConfig: { access: 'public' },
};
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(cli, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# Agent Standup (command line)

Your Claude Code sessions as a live team call, without any editor. Free, MIT, and it never calls Claude: it only reads the session files Claude Code already writes.

\`\`\`bash
npx ${NAME}            # then open http://localhost:4747   (add --open to open it for you)
npx ${NAME} status     # ⚙ 3 working · ✋ 1 needs you
\`\`\`

Install once for status bars (faster than npx): \`npm i -g ${NAME}\`

- **Claude Code status line**: in \`~/.claude/settings.json\` add \`{ "statusLine": { "type": "command", "command": "agent-standup statusline" } }\`
- **tmux**: \`set -g status-right '#(agent-standup status --here)'\`
- **Anything else**: \`agent-standup status --json\`

Full documentation, the VS Code extension, the desktop app and the demo: ${pkg.homepage} · ${String(pkg.repository.url).replace(/\\.git$/, '')}

Unofficial: not affiliated with Anthropic.
`);
console.log(`staged ${NAME}@${pkg.version} in dist-cli/`);
