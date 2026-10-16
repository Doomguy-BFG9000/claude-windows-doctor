// Every claude on the machine: where it came from, which one runs first, its version asked in a throwaway folder, and what is never run.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine, SYSTEM_PATH } from "./machine.mjs";
import { compareVersions, findClaudes, originOf, throwawayEnv, versionOf } from "../src/binaries.mjs";

const HOME = "C:\\Users\\me";
const APPDATA = `${HOME}\\AppData\\Roaming`;
const LOCAL = `${HOME}\\AppData\\Local`;
const BASE = { USERPROFILE: HOME, APPDATA, LOCALAPPDATA: LOCAL };

test("originOf names where a claude came from, from its path", () => {
  const cases = {
    [`${HOME}\\.local\\bin\\claude.exe`]: "native",
    [`${APPDATA}\\npm\\claude.cmd`]: "npm",
    [`${LOCAL}\\Microsoft\\WinGet\\Links\\claude.exe`]: "winget",
    [`${LOCAL}\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe`]: "winget",
    [`${APPDATA}\\Claude\\claude-code\\2.1.299\\f0584be0fbaf\\claude.exe`]: "desktop-bundle",
    [`${LOCAL}\\AnthropicClaude\\claude.exe`]: "desktop-launcher",
    [`${LOCAL}\\Microsoft\\WindowsApps\\claude.exe`]: "store-alias",
    [`${HOME}\\.vscode\\extensions\\anthropic.claude-code-2.1.0\\resources\\native-binary\\claude.exe`]: "vscode",
    "C:\\nvm\\v22\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe": "npm",
    "D:\\tools\\claude.exe": "other",
  };
  for (const [file, origin] of Object.entries(cases)) assert.equal(originOf(file), origin, file);
  assert.equal(originOf("/mnt/c/Users/me/.local/bin/claude.exe", "linux"), "windows");
  assert.equal(originOf("/home/me/.local/bin/claude", "linux"), "native");
  assert.equal(originOf("/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js", "linux"), "npm");
  assert.equal(originOf("/usr/bin/claude", "linux"), "package");
  assert.equal(originOf("/opt/x/claude", "linux"), "other");
});

test("compareVersions", () => {
  assert.equal(compareVersions("2.1.299", "2.1.295"), 1);
  assert.equal(compareVersions("2.1.9", "2.1.10"), -1);
  assert.equal(compareVersions("2.1.299", "2.1.299"), 0);
  assert.equal(compareVersions(null, "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", null), 1);
  assert.equal(compareVersions(null, null), 0);
  assert.equal(compareVersions("3.0.0", "2.99.99"), 1);
});

test("PATH in order, with the extensions of PATHEXT; the first program on PATH is the one a shell runs; versions come from --version", () => {
  const native = `${HOME}\\.local\\bin\\claude.exe`;
  const npm = `${APPDATA}\\npm\\claude.cmd`;
  const sys = fakeMachine({
    env: { ...BASE, Path: `${APPDATA}\\npm;${HOME}\\.local\\bin;${SYSTEM_PATH}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    files: [native, npm, `${APPDATA}\\npm\\claude.ps1`, `${APPDATA}\\npm\\claude`],
    versions: { [native]: "2.1.299 (Claude Code)", [npm]: "2.1.295 (Claude Code)" },
  });
  const r = findClaudes(sys, { dir: "C:\\Temp\\cwd-x" });
  assert.deepEqual(r.entries.map((e) => [e.path, e.origin, e.version, e.runsFirst, e.onPath]), [
    [npm, "npm", "2.1.295", true, true],
    [native, "native", "2.1.299", false, true],
  ], "the .ps1 and the extensionless file of npm are the same install as its .cmd");
  assert.equal(r.first.path, npm);
  // the version run: the .cmd through cmd.exe, the .exe by itself, in a throwaway folder, with a clean environment
  const run = sys.runs.find((x) => x.args.includes("--version") && x.cmd === native);
  assert.equal(run.opts.cwd, "C:\\Temp\\cwd-x");
  assert.equal(run.opts.env.CLAUDE_CONFIG_DIR, "C:\\Temp\\cwd-x\\.claude");
  assert.equal(run.opts.env.HOME, "C:\\Temp\\cwd-x");
  assert.equal(run.opts.env.DISABLE_AUTOUPDATER, "1");
  const shim = sys.runs.find((x) => /cmd/i.test(x.cmd) && /claude\.cmd/.test(x.args.join(" ")));
  assert.deepEqual(shim.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(shim.args[3], `""${npm}" --version"`);
  assert.equal(shim.opts.verbatim, true);
});

test("PATHEXT decides between claude.exe and claude.cmd in one folder, in its order", () => {
  const sys = fakeMachine({ env: { ...BASE, Path: `C:\\t;${SYSTEM_PATH}`, PATHEXT: ".CMD;.EXE" }, files: ["C:\\t\\claude.exe", "C:\\t\\claude.cmd"], versions: { "C:\\t\\claude.exe": "1.0.0", "C:\\t\\claude.cmd": "2.0.0" } });
  const r = findClaudes(sys, { dir: "C:\\Temp\\cwd-x" });
  assert.equal(r.first.path, "C:\\t\\claude.cmd", ".CMD is before .EXE here");
  assert.equal(r.entries.length, 2);
});

test("the places the installers use are listed when they are not on PATH; the desktop app's launcher and a Store alias are named and never run", () => {
  const bundle = `${APPDATA}\\Claude\\claude-code\\2.1.299\\f0584be0fbaf\\claude.exe`;
  const launcher = `${LOCAL}\\AnthropicClaude\\claude.exe`;
  const alias = `${LOCAL}\\Microsoft\\WindowsApps\\claude.exe`;
  const winget = `${LOCAL}\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe`;
  const vscode = `${HOME}\\.vscode\\extensions\\anthropic.claude-code-2.1.0\\resources\\native-binary\\claude.exe`;
  const sys = fakeMachine({ env: { ...BASE, Path: SYSTEM_PATH }, files: [bundle, launcher, alias, winget, vscode, `${HOME}\\.local\\bin\\claude.exe`], versions: { [bundle]: "2.1.299 (Claude Code)", [winget]: "2.1.250 (Claude Code)", [vscode]: "2.1.100 (Claude Code)", [`${HOME}\\.local\\bin\\claude.exe`]: "2.1.290 (Claude Code)" } });
  const r = findClaudes(sys, { dir: "C:\\Temp\\cwd-x" });
  assert.equal(r.first, null, "nothing is on PATH");
  const byPath = Object.fromEntries(r.entries.map((e) => [e.path, e]));
  assert.equal(byPath[bundle].version, "2.1.299");
  assert.equal(byPath[bundle].onPath, false);
  assert.equal(byPath[launcher].origin, "desktop-launcher");
  assert.match(byPath[launcher].skipped, /desktop app's launcher/);
  assert.equal(byPath[alias].origin, "store-alias");
  assert.equal(byPath[winget].origin, "winget");
  assert.equal(byPath[vscode].origin, "vscode");
  assert.ok(!sys.runs.some((x) => x.cmd === launcher || x.cmd === alias), "the launcher and the alias are never started");
});

test("a launcher that is first on PATH is reported as the first, and still not run", () => {
  const launcher = `${LOCAL}\\AnthropicClaude\\claude.exe`;
  const sys = fakeMachine({ env: { ...BASE, Path: `${LOCAL}\\AnthropicClaude;${SYSTEM_PATH}` }, files: [launcher] });
  const r = findClaudes(sys, { dir: "C:\\Temp\\cwd-x" });
  assert.equal(r.first.path, launcher);
  assert.equal(r.first.version, null);
  assert.equal(sys.runs.length, 0);
});

test("a claude that cannot be started, times out or prints no version says so", () => {
  const a = "C:\\a\\claude.exe";
  const b = "C:\\b\\claude.exe";
  const c = "C:\\c\\claude.exe";
  const sys = fakeMachine({ env: { ...BASE, Path: `C:\\a;C:\\b;C:\\c;${SYSTEM_PATH}` }, files: [a, b, c] });
  sys.run = (cmd) => {
    if (cmd === a) return { status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn"), { code: "EACCES" }), timedOut: false };
    if (cmd === b) return { status: null, stdout: "", stderr: "", error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }), timedOut: true };
    return { status: 1, stdout: "", stderr: "boom\nmore", error: null, timedOut: false };
  };
  const r = findClaudes(sys, { dir: "C:\\Temp\\cwd-x" });
  assert.match(r.entries[0].note, /could not start \(EACCES\)/);
  assert.match(r.entries[1].note, /no answer in 30 seconds/);
  assert.match(r.entries[2].note, /did not print a version \(exit 1: boom\)/);
  assert.deepEqual(r.entries.map((e) => e.version), [null, null, null]);
});

test("versionOf asks one file; runVersion false asks none", () => {
  const f = "C:\\x\\claude.exe";
  const sys = fakeMachine({ env: { ...BASE, Path: `C:\\x;${SYSTEM_PATH}` }, files: [f], versions: { [f]: "2.1.301 (Claude Code)" } });
  assert.equal(versionOf(sys, f, "C:\\Temp\\cwd-x"), "2.1.301");
  sys.runs.length = 0;
  const r = findClaudes(sys, { runVersion: false });
  assert.equal(r.entries[0].version, null);
  assert.equal(sys.runs.length, 0);
});

test("throwawayEnv takes out every CLAUDE_*, ANTHROPIC_*, CLAUDECODE*, AI_AGENT and MCP_ variable and puts the home and config folders in the throwaway folder", () => {
  const sys = fakeMachine({ env: { Path: "C:\\x", PATHEXT: ".EXE", CLAUDE_CONFIG_DIR: "C:\\real", ANTHROPIC_API_KEY: "sk-ant-real", CLAUDECODE: "1", claude_code_x: "1", AI_AGENT: "x", MCP_TIMEOUT: "9", ENABLE_TOOL_SEARCH: "true", USERPROFILE: "C:\\real", HOME: "C:\\real", Keep: "yes" } });
  const e = throwawayEnv(sys, "C:\\Temp\\cwd-x");
  assert.deepEqual(Object.keys(e).sort(), ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CONFIG_DIR", "DISABLE_AUTOUPDATER", "DISABLE_TELEMETRY", "HOME", "Keep", "NO_COLOR", "PATHEXT", "Path", "USERPROFILE"].sort());
  assert.equal(e.USERPROFILE, "C:\\Temp\\cwd-x");
  assert.equal(e.CLAUDE_CONFIG_DIR, "C:\\Temp\\cwd-x\\.claude");
  assert.ok(!JSON.stringify(e).includes("sk-ant-real"));
});

test("in WSL: PATH is read with colons, a claude under /mnt is a Windows program, and ~/.local/bin is a place of its own", () => {
  const sys = fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", files: ["/mnt/c/Users/me/.local/bin/claude", "/home/me/.local/bin/claude"], versions: { "/mnt/c/Users/me/.local/bin/claude": "2.1.299 (Claude Code)", "/home/me/.local/bin/claude": "2.1.299 (Claude Code)" } });
  const r = findClaudes(sys, { dir: "/tmp/cwd-x" });
  assert.deepEqual(r.entries.map((e) => [e.path, e.origin, e.onPath, e.runsFirst]), [["/mnt/c/Users/me/.local/bin/claude", "windows", true, true], ["/home/me/.local/bin/claude", "native", false, false]]);
});
