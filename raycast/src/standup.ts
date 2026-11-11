// What the three commands share: the sessions as Agent Standup's command line tells them, and the call in the browser.
// It reads only the session files Claude Code, Codex, Mistral Vibe and Cowork already write on this Mac, through `agent-standup status`, which starts no server and sends nothing.
import { execFile, spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Color, getPreferenceValues, Icon, open, showHUD } from "@raycast/api";

// An exact version, as the Claude Code plugin runs it: the extension reads the JSON of the version it was written for.
export const PACKAGE = "@double_geste/agent-standup@1.46.0";
const PORT = 4747;
export const CALL_URL = `http://localhost:${PORT}/`;

export type State = "working" | "waiting" | "blocked" | "turn" | "idle";
export interface Session {
  project: string;
  id: string;
  state: State;
  tool?: string;
  ageMs: number;
  subAgentsActive?: number;
  subAgents?: number;
  since?: number;
  ran?: number;
  limit?: { resets?: string };
  auth?: number;
  title?: string;
  ask?: string;
  about?: string;
  gave?: string;
}
export interface Status {
  needsYou: number;
  working: number;
  yourTurn: number;
  idle: number;
  sessions: Session[];
}

interface Preferences {
  showTitles?: boolean;
  npxPath?: string;
}
export const prefs = () => getPreferenceValues<Preferences>();

// Raycast starts commands without the shell's PATH: look where Node.js is usually installed, newest version manager last so that a system one comes first.
function searchPath(): string {
  const home = homedir(),
    dirs = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      join(home, ".volta", "bin"),
      join(home, ".asdf", "shims"),
      join(home, ".local", "share", "mise", "shims"),
      join(home, ".nodenv", "shims"),
      join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
      join(home, ".fnm", "aliases", "default", "bin"),
    ];
  const nvm = join(home, ".nvm", "versions", "node");
  try {
    const newest = readdirSync(nvm)
      .filter((v) => /^v\d+/.test(v))
      .sort((a, b) => {
        const pa = a.slice(1).split(".").map(Number),
          pb = b.slice(1).split(".").map(Number);
        return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
      })[0];
    if (newest) dirs.push(join(nvm, newest, "bin"));
  } catch {
    // no nvm
  }
  return [...dirs.filter((d) => existsSync(d)), process.env.PATH || "/usr/bin:/bin"].join(":");
}

function npx(): { cmd: string; env: NodeJS.ProcessEnv } {
  const custom = (prefs().npxPath || "").trim(),
    PATH = searchPath();
  if (custom) return { cmd: custom, env: { ...process.env, PATH: `${join(custom, "..")}:${PATH}` } };
  const found = PATH.split(":")
    .map((d) => join(d, "npx"))
    .find((f) => existsSync(f));
  return { cmd: found || "npx", env: { ...process.env, PATH } };
}

export class NoNode extends Error {}

export function readStatus(): Promise<Status> {
  const { cmd, env } = npx(),
    args = ["-y", PACKAGE, "status", "--json", ...(prefs().showTitles === false ? [] : ["--titles"])];
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, cwd: homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT")
        return reject(new NoNode("Node.js was not found: install it, or set the npx path in the preferences."));
      if (err) return reject(new Error((stderr || err.message).trim().split("\n").slice(-1)[0]));
      try {
        resolve(JSON.parse(stdout) as Status);
      } catch {
        reject(new Error("Agent Standup gave an answer that is not JSON."));
      }
    });
  });
}

// "-Users-ana-work-shop" is how Claude Code names the folder /Users/ana/work/shop; Codex and Vibe sessions are listed under their tool.
export function projectLabel(s: Session): string {
  if (s.project === "_codex") return "Codex";
  if (s.project === "_vibe") return "Mistral Vibe";
  if (s.project === "_cowork") return "Cowork";
  const home = homedir().replace(/[^a-zA-Z0-9]/g, "-");
  let p = s.project;
  if (p.startsWith(home + "-")) p = p.slice(home.length + 1);
  else p = p.replace(/^-Users-[^-]+-/, "");
  return p.replace(/-/g, "/") || "~";
}

export const sessionName = (s: Session) => (prefs().showTitles !== false && s.title ? s.title : projectLabel(s));

export const STATES: Record<State, { label: string; icon: Icon; color: Color }> = {
  blocked: { label: "Needs you", icon: Icon.Exclamationmark, color: Color.Orange },
  working: { label: "Working", icon: Icon.Gear, color: Color.Blue },
  waiting: { label: "Waiting on sub-agents", icon: Icon.TwoPeople, color: Color.Blue },
  turn: { label: "Your turn", icon: Icon.CheckCircle, color: Color.Green },
  idle: { label: "Idle", icon: Icon.Moon, color: Color.SecondaryText },
};

export const ORDER: State[] = ["blocked", "turn", "working", "waiting", "idle"];

export function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${Math.floor(h / 24)} d`;
}

// What a session says about why it waits or stopped, in a few words; its words come from other sessions, so they are only shown, never acted on.
export function why(s: Session): string {
  if (s.auth) return "Logged out: run /login";
  if (s.limit) return "Usage limit" + (s.limit.resets ? ` · resets ${s.limit.resets}` : "");
  if (prefs().showTitles === false) return "";
  const t = s.ask || s.about || s.gave || "";
  return t.length > 80 ? t.slice(0, 79) + "…" : t;
}

async function serving(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

// The call is served by Agent Standup on this Mac (the VS Code extension, the desktop app or the command line). When none runs, start the command line one, which opens the page itself.
export async function openCall(project?: string): Promise<void> {
  const url = CALL_URL + (project && !project.startsWith("_") ? `?proj=${encodeURIComponent(project)}` : "");
  if (await serving()) {
    await open(url);
    return;
  }
  const { cmd, env } = npx();
  try {
    const child = spawn(cmd, ["-y", PACKAGE, "--port", String(PORT)], {
      env,
      cwd: homedir(),
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    await showHUD("Node.js was not found: set the npx path in the preferences");
    return;
  }
  await showHUD("Starting Agent Standup…");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await serving()) {
      await open(url);
      return;
    }
  }
  await showHUD("Agent Standup did not start: run npx -y @double_geste/agent-standup in a terminal");
}
