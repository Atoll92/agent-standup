// Where the sessions are read from, as the environment says. The core itself reads no environment: createCore (index.js) is given
// these two values, so two cores in one process can read two different places. Nothing here is written to.
const os = require('os'), path = require('path');

// The folder Claude Code writes its sessions to: honours CLAUDE_CONFIG_DIR (custom config dirs are common on Linux);
// AGENT_STANDUP_PROJECTS overrides it.
function claudeProjectsRoot(env = process.env) {
  return env.AGENT_STANDUP_PROJECTS || path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

// Where Codex keeps its files: AGENT_STANDUP_CODEX (a folder; "0" or "off" turns Codex sessions off), else $CODEX_HOME, else ~/.codex.
// When AGENT_STANDUP_PROJECTS points the app at one folder of Claude Code sessions (--projects, the tests), Codex is only read if it is asked for too.
// null: Codex sessions are off.
function codexHomeFromEnv(env = process.env) {
  const v = env.AGENT_STANDUP_CODEX;
  if (v != null) return /^(0|off|no|false)?$/i.test(v.trim()) ? null : v;
  if (env.AGENT_STANDUP_PROJECTS) return null;
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

// The options of createCore, from the environment.
const configFromEnv = (env = process.env) => ({ root: claudeProjectsRoot(env), codexHome: codexHomeFromEnv(env) });

module.exports = { claudeProjectsRoot, codexHomeFromEnv, configFromEnv };
