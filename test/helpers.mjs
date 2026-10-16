// Shared test helpers: throwaway worlds (a home folder, a Claude config folder, project folders, a file standing in for the
// registry's user environment) and ways to run the CLI.
//
// SAFETY: nothing here reads or writes the real Claude folder, the real settings or the real Windows user environment. Importing
// this file points HOME, USERPROFILE, APPDATA, LOCALAPPDATA, CLAUDE_CONFIG_DIR, the managed-settings folder and the user environment
// of this process at throwaway places (CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE makes the tool read and write a JSON file where it
// would use HKCU\Environment, so no test can change the registry), so even a test that forgets to pass its own environment cannot
// reach them. Every child process gets a world's environment, and runCli refuses to run with a config or home folder outside the
// OS temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "claude-windows-doctor.mjs");
export const IS_WIN = process.platform === "win32";
export const NOW = Date.parse("2026-10-16T12:00:00.000Z");

const made = [];
export function tmpDir(prefix = "cwd-") {
  // the native real path: on Windows it also turns a short name (RUNNER~1) into the long one, which is what the tool sees
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
process.on("exit", () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ } } });

// The guard: an empty home, config folder, managed folder and user environment for this process.
const guard = tmpDir("cwd-guard-");
export const GUARD = guard;
Object.assign(process.env, {
  HOME: guard,
  USERPROFILE: guard,
  APPDATA: path.join(guard, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(guard, "AppData", "Local"),
  CLAUDE_CONFIG_DIR: path.join(guard, ".claude"),
  CLAUDE_WINDOWS_DOCTOR_MANAGED_DIR: path.join(guard, "no-managed-settings"),
  CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE: path.join(guard, "user-env.json"),
  NO_COLOR: "1",
});
delete process.env.FORCE_COLOR;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.CLAUDECODE;
for (const k of Object.keys(process.env)) if (/^(CLAUDE_CODE_|ANTHROPIC_)/.test(k)) delete process.env[k];

const underTmp = (p) => path.resolve(p).toLowerCase().startsWith(fs.realpathSync.native(os.tmpdir()).toLowerCase());
const configDirOf = (e) => e.CLAUDE_CONFIG_DIR || path.join((process.platform === "win32" ? e.USERPROFILE || e.HOME : e.HOME) || "", ".claude");

const asText = (v) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
export const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, asText(v)); return file; };
export const fwd = (p) => String(p).split(path.sep).join("/");

/**
 * A throwaway world on the real disk. base/home/.claude is the config folder (CLAUDE_CONFIG_DIR), base/work/proj the project folder,
 * base/managed the managed-settings folder, base/user-env.json the file that stands in for HKCU\Environment.
 */
export function world(name = "w") {
  const base = tmpDir(`cwd-${name}-`);
  const home = path.join(base, "home");
  const claude = path.join(home, ".claude");
  const work = path.join(base, "work", "proj");
  for (const d of [claude, work]) fs.mkdirSync(d, { recursive: true });
  const userEnvFile = path.join(base, "user-env.json");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    CLAUDE_CONFIG_DIR: claude,
    CLAUDE_WINDOWS_DOCTOR_MANAGED_DIR: path.join(base, "managed"),
    CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE: userEnvFile,
    NO_COLOR: "1",
  };
  delete env.FORCE_COLOR;
  const w = {
    base, home, claude, work, env, userEnvFile,
    userFile: path.join(claude, "settings.json"),
    projectFile: path.join(work, ".claude", "settings.json"),
    localFile: path.join(work, ".claude", "settings.local.json"),
    recordFile: path.join(claude, "windows-doctor", "record.json"),
    write: (file, v) => put(file, v),
    read: (file) => fs.readFileSync(file, "utf8"),
    exists: (file) => fs.existsSync(file),
    readJson: (file) => JSON.parse(fs.readFileSync(file, "utf8")),
    user: (v) => put(w.userFile, v),
    project: (v) => put(w.projectFile, v),
    local: (v) => put(w.localFile, v),
    userEnv: () => (fs.existsSync(userEnvFile) ? JSON.parse(fs.readFileSync(userEnvFile, "utf8")) : {}),
    setUserEnv: (obj) => put(userEnvFile, obj),
  };
  return w;
}

/** Runs the real CLI in a child process. */
export function runCli(args, { cwd, env, input, timeout = 120000 } = {}) {
  const e = { ...process.env, ...env };
  if (!underTmp(configDirOf(e)) || !underTmp(e.HOME || "") || !underTmp(e.USERPROFILE || "") || !e.CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE) {
    throw new Error("runCli needs an environment from world(): the Claude config and home folders must be temporary, and the user environment a file");
  }
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, input: input ?? "", encoding: "utf8", windowsHide: true, timeout });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

/** Runs main() in this process, on the machine `sys` (a pretend one from test/machine.mjs, or the real one), and captures what it prints. */
export async function run(args, { sys, userEnv, now = NOW, env } = {}) {
  let out = "";
  let err = "";
  const code = await main(args, {
    sys,
    userEnv,
    env,
    now,
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  });
  return { code, out, err, all: out + err, json: () => JSON.parse(out) };
}
