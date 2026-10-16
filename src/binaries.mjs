// Every `claude` the machine has: the ones on PATH, in the order a shell looks, and the places the installers use (the native
// installer's .local\bin, the npm global folder, WinGet, the desktop app's bundles, the editors' extensions), each with its version
// and where it came from, and which one runs first. The version is asked with `--version`, in a throwaway config folder, with an
// environment that has no CLAUDE_* or ANTHROPIC_* variable: nothing is read from or written to the real ~/.claude.
//
// Two files are never run: the desktop app's own launcher (it opens the app) and a Microsoft Store alias. A claude that is an npm shim
// (claude.cmd) is run through cmd.exe, as a shell does.
import path from "node:path";
import * as W from "./winpath.mjs";

export const ORIGIN_TEXT = {
  native: "the native installer",
  npm: "npm (global)",
  winget: "WinGet",
  "desktop-bundle": "bundled by the Claude desktop app",
  "desktop-launcher": "the Claude desktop app's launcher (not the CLI)",
  "store-alias": "a Microsoft Store app alias (not run)",
  vscode: "an editor extension's bundled binary",
  package: "a system package",
  windows: "a Windows program reached through WSL",
  other: "an unknown source",
};
// the origins that are a command-line install of its own (the others belong to an app)
export const CLI_ORIGINS = new Set(["native", "npm", "winget", "package", "other"]);

/** Where a claude file came from, from its path. */
export function originOf(file, platform = "win32") {
  const f = String(file);
  if (platform !== "win32") {
    if (/^\/mnt\/[a-z]\//i.test(f)) return "windows";
    if (/\/\.local\/bin\/claude$/.test(f)) return "native";
    if (/node_modules\/(\.bin|@anthropic-ai\/claude-code)/.test(f) || /\/lib\/node_modules\//.test(f)) return "npm";
    if (/^\/usr\/(local\/)?bin\/claude$/.test(f)) return "package";
    return "other";
  }
  const k = W.key(f);
  if (k.includes("\\anthropicclaude\\")) return "desktop-launcher";
  if (k.includes("\\microsoft\\windowsapps\\")) return "store-alias";
  if (/\\claude\\claude-code\\[^\\]+\\[^\\]+\\claude\.exe$/.test(k)) return "desktop-bundle";
  if (/\\\.local\\bin\\claude\.exe$/.test(k)) return "native";
  if (k.includes("\\winget\\")) return "winget";
  if (/\\extensions\\anthropic\.claude-code[^\\]*\\/.test(k)) return "vscode";
  if (/\\node_modules\\@anthropic-ai\\claude-code\\/.test(k) || /\\claude\.(cmd|ps1)$/.test(k)) return "npm";
  return "other";
}

const PROGRAM_EXT = [".com", ".exe", ".bat", ".cmd"];

/** The places to look in besides PATH, on Windows: [{ path, hint }]. Folders that cannot be listed give nothing. */
function knownPlaces(sys) {
  const out = [];
  const home = sys.home;
  const appdata = sys.getEnv("APPDATA") || (home ? W.join(home, "AppData", "Roaming") : "");
  const local = sys.getEnv("LOCALAPPDATA") || (home ? W.join(home, "AppData", "Local") : "");
  if (home) out.push({ path: W.join(home, ".local", "bin", "claude.exe") });
  if (appdata) out.push({ path: W.join(appdata, "npm", "claude.cmd") });
  if (local) {
    out.push({ path: W.join(local, "Microsoft", "WinGet", "Links", "claude.exe") });
    out.push({ path: W.join(local, "AnthropicClaude", "claude.exe") });
    out.push({ path: W.join(local, "Microsoft", "WindowsApps", "claude.exe") });
    const pk = W.join(local, "Microsoft", "WinGet", "Packages");
    for (const n of sys.listDir(pk) || []) if (/^Anthropic\.ClaudeCode/i.test(n)) out.push({ path: W.join(pk, n, "claude.exe") });
  }
  if (appdata) {
    const base = W.join(appdata, "Claude", "claude-code");
    for (const v of sys.listDir(base) || []) for (const h of sys.listDir(W.join(base, v)) || []) out.push({ path: W.join(base, v, h, "claude.exe") });
  }
  if (home) {
    for (const ed of [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]) {
      const ext = W.join(home, ed, "extensions");
      for (const n of sys.listDir(ext) || []) if (/^anthropic\.claude-code/i.test(n)) out.push({ path: W.join(ext, n, "resources", "native-binary", "claude.exe") });
    }
  }
  return out;
}

/** The program files named claude in the PATH folders of a Windows machine, in the order cmd.exe and PowerShell look. */
function scanWindowsPath(sys) {
  const dirs = W.splitList(sys.getEnv("PATH"));
  const exts = W.pathExt(sys.getEnv("PATHEXT")).filter((e) => PROGRAM_EXT.includes(e));
  const out = [];
  dirs.forEach((dir, pathIndex) => {
    let any = false;
    for (const e of exts) {
      const f = W.join(dir, `claude${e}`);
      if (sys.isFile(f)) { out.push({ path: f, dir, pathIndex, kind: "program" }); any = true; }
    }
    if (!any) {
      // npm also writes claude.ps1 and a file with no extension: they only matter when there is no .cmd beside them
      for (const n of ["claude.ps1", "claude"]) {
        const f = W.join(dir, n);
        if (sys.isFile(f)) { out.push({ path: f, dir, pathIndex, kind: "script" }); break; }
      }
    }
  });
  return out;
}

function scanPosixPath(sys) {
  const dirs = String(sys.getEnv("PATH") || "").split(":").filter(Boolean);
  const out = [];
  dirs.forEach((dir, pathIndex) => {
    const f = path.posix.join(dir, "claude");
    if (sys.isFile(f)) out.push({ path: f, dir, pathIndex, kind: "program" });
  });
  return out;
}

/** The environment a `--version` run gets: no CLAUDE_*, ANTHROPIC_*, CLAUDECODE or AI_AGENT variable, no updates, no telemetry, and a throwaway home and config folder. */
export function throwawayEnv(sys, dir) {
  const env = {};
  for (const [k, v] of Object.entries(sys.env)) if (!/^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH)/i.test(k)) env[k] = v;
  const set = (name, value) => {
    const lower = name.toLowerCase();
    for (const k of Object.keys(env)) if (k.toLowerCase() === lower) delete env[k];
    env[name] = value;
  };
  set("DISABLE_AUTOUPDATER", "1");
  set("DISABLE_TELEMETRY", "1");
  set("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
  set("NO_COLOR", "1");
  set("HOME", dir);
  set("USERPROFILE", dir);
  set("CLAUDE_CONFIG_DIR", sys.platform === "win32" ? W.join(dir, ".claude") : path.posix.join(dir, ".claude"));
  return env;
}

function askVersion(sys, file, dir) {
  const env = throwawayEnv(sys, dir);
  const ext = sys.platform === "win32" ? W.extname(file).toLowerCase() : "";
  let r;
  if (ext === ".cmd" || ext === ".bat") r = sys.run("cmd.exe", ["/d", "/s", "/c", `""${file}" --version"`], { env, cwd: dir, verbatim: true, timeout: 30000 });
  else r = sys.run(file, ["--version"], { env, cwd: dir, timeout: 30000 });
  if (r.error) return { version: null, note: r.timedOut ? "no answer in 30 seconds" : `could not start (${r.error.code || r.error.message})` };
  const m = /(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)/.exec(r.stdout || "");
  if (r.status === 0 && m) return { version: m[1], note: null };
  return { version: null, note: `did not print a version (exit ${r.status}${String(r.stderr || "").trim() ? `: ${String(r.stderr).trim().split("\n")[0].slice(0, 80)}` : ""})` };
}

/** The version that `file --version` prints, asked in a throwaway folder `dir`, or null. */
export function versionOf(sys, file, dir) {
  return askVersion(sys, file, dir).version;
}

/** Compares two versions as numbers: -1, 0 or 1. A missing version is lower than any. */
export function compareVersions(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Every claude on the machine.
 *   dir        a throwaway folder for the `--version` runs (the caller makes and removes it)
 *   runVersion false leaves the versions out
 * Returns { entries, first }: entries are { path, origin, kind, onPath, pathIndex, runsFirst, version, note, skipped } in the order of PATH, then the
 * places the installers use; `first` is the entry that a shell runs for `claude` (the first program on PATH), or null.
 */
export function findClaudes(sys, { dir, runVersion = true } = {}) {
  const win = sys.platform === "win32";
  const onPath = win ? scanWindowsPath(sys) : scanPosixPath(sys);
  const seen = new Set();
  const key = (p) => (win ? W.key(p) : p);
  const entries = [];
  for (const e of onPath) {
    if (seen.has(key(e.path))) continue;
    seen.add(key(e.path));
    entries.push({ ...e, onPath: true, origin: originOf(e.path, sys.platform) });
  }
  if (win) {
    for (const p of knownPlaces(sys)) {
      if (!sys.isFile(p.path) || seen.has(key(p.path))) continue;
      seen.add(key(p.path));
      entries.push({ path: p.path, dir: W.dirname(p.path), pathIndex: null, kind: "program", onPath: false, origin: originOf(p.path, sys.platform) });
    }
  } else {
    const local = sys.home ? path.posix.join(sys.home, ".local", "bin", "claude") : null;
    if (local && sys.isFile(local) && !seen.has(local)) entries.push({ path: local, dir: path.posix.dirname(local), pathIndex: null, kind: "program", onPath: false, origin: originOf(local, sys.platform) });
  }
  const first = entries.find((e) => e.onPath && e.kind === "program") || null;
  for (const e of entries) {
    e.runsFirst = e === first;
    e.skipped = e.origin === "desktop-launcher" || e.origin === "store-alias" || e.kind === "script" ? (e.kind === "script" ? "a script, not run (the same install as the .cmd of npm)" : `${ORIGIN_TEXT[e.origin]}`) : null;
    e.version = null;
    e.note = null;
    if (runVersion && dir && !e.skipped) Object.assign(e, askVersion(sys, e.path, dir));
  }
  return { entries, first };
}
