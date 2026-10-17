// check --live against the real Claude Code binary (run only when E2E_CLAUDE points at one, and only on Windows): the tool starts the binary through its own fake
// API in a throwaway world, copies the few settings that decide the shell, and says whether what the binary listed is what it predicted. Each case here is a setup
// (fake Git trees, PATH, variables, settings files), put through the whole command, and the answer must be "proved". No token is spent.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, world } from "./helpers.mjs";
import { CLAUDE, claudeInfo, setVar, skipUnlessWindows } from "./claude-sandbox.mjs";
import { makeSys } from "../src/sys.mjs";
import { fileUserEnv } from "../src/write.mjs";
import { FIXED_BASH } from "../src/shell.mjs";

const HAS_DEFAULT_GIT = process.platform === "win32" && FIXED_BASH.some((p) => fs.existsSync(p));
const SYSROOT = process.env.SystemRoot || "C:\\Windows";
const SYSTEM_PATH = [path.win32.join(SYSROOT, "System32"), SYSROOT].join(";");

/** A world with fake Git trees under base/git: g1 (cmd\git.exe, bin\bash.exe) and g2 (mingw64\bin\git.exe, bin\bash.exe). */
function setup(label) {
  const w = world(label);
  const git = (n, ...files) => files.map((f) => { const p = path.join(w.base, "git", n, ...f.split("/")); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); return p; });
  git("g1", "cmd/git.exe", "bin/bash.exe");
  git("g2", "mingw64/bin/git.exe", "bin/bash.exe");
  return { w, g1: path.join(w.base, "git", "g1"), g2: path.join(w.base, "git", "g2") };
}
/** check --live --json in a world: the process environment is the world's, with PATH and variables as the case says. */
async function live(w, { path: dirs = [], env = {}, extra = [] } = {}) {
  const e = { ...w.env };
  setVar(e, "Path", [...dirs, SYSTEM_PATH].join(";"));
  for (const [k, v] of Object.entries(env)) setVar(e, k, v);
  const sys = makeSys({ env: e, cwd: w.work, home: w.home });
  const r = await run(["check", "--live", "--json", "--claude", CLAUDE, "--project", w.work, ...extra], { sys, userEnv: fileUserEnv(w.userEnvFile) });
  return { ...r, doc: r.out.trim() ? JSON.parse(r.out) : null };
}
const skip = () => skipUnlessWindows();

test("check --live: a valid CLAUDE_CODE_GIT_BASH_PATH: the binary lists Bash, takes that file, and the proof says so", { skip: skip(), timeout: 600000 }, async (t) => {
  const { w, g1 } = setup("live1");
  const bash = path.join(g1, "bin", "bash.exe").replace(/\\/g, "/");
  const r = await live(w, { env: { CLAUDE_CODE_GIT_BASH_PATH: bash } });
  assert.equal(r.doc.live.ok, true);
  assert.equal(r.doc.live.proved, true, JSON.stringify(r.doc.live.differences));
  assert.deepEqual(r.doc.live.actual.tools, ["Bash"]);
  assert.equal(path.win32.normalize(r.doc.live.actual.bash).toLowerCase(), path.win32.normalize(bash).toLowerCase());
  assert.equal(r.doc.live.claude.version, claudeInfo().number);
  assert.equal(r.doc.live.exitCode, 0);
  assert.equal(r.doc.shell.gitBash.how, "variable");
  t.diagnostic(`proved on Claude Code ${claudeInfo().number}: ${r.doc.live.actual.tools.join(" and ")}, took ${r.doc.live.actual.bash}`);
  // the text form of the same run says so in words
  const e = { ...w.env }; setVar(e, "Path", SYSTEM_PATH); setVar(e, "CLAUDE_CODE_GIT_BASH_PATH", bash);
  const text = await run(["check", "--live", "--claude", CLAUDE, "--project", w.work], { sys: makeSys({ env: e, cwd: w.work, home: w.home }), userEnv: fileUserEnv(w.userEnvFile) });
  assert.match(text.out, /live {14}proved with the real claude \S+ \(.*claude(?:\.exe|\.cmd)?\), through a fake API on 127\.0\.0\.1 \(no token spent\):/);
  assert.match(text.out, /the first request listed Bash, and it took /);
});

test("check --live: Git Bash that PATH does not lead to (mingw64\\bin first): the binary lists PowerShell, the proof agrees, and the finding says what would help", { skip: skip() || (HAS_DEFAULT_GIT && "Git at C:\\Program Files\\Git is found whatever PATH says"), timeout: 600000 }, async () => {
  const { w, g2 } = setup("live2");
  const r = await live(w, { path: [path.join(g2, "mingw64", "bin")] });
  assert.equal(r.doc.live.proved, true, JSON.stringify(r.doc.live.differences));
  assert.deepEqual(r.doc.live.actual.tools, ["PowerShell"]);
  assert.equal(r.doc.live.actual.bash, null);
  assert.ok(r.doc.findings.some((f) => f.id === "git-bash-not-found"), "the Git for Windows that PATH leads to wrongly is named");
  assert.equal(r.doc.live.edition !== null, true, "the edition of PowerShell is in the tool's description");
  assert.equal(r.code, 1, "findings: exit 1");
});

test("check --live: Git Bash where PATH leads to it (cmd first)", { skip: skip() || (HAS_DEFAULT_GIT && "Git at C:\\Program Files\\Git is found whatever PATH says"), timeout: 600000 }, async () => {
  const { w, g1 } = setup("live3");
  const r = await live(w, { path: [path.join(g1, "cmd")] });
  assert.equal(r.doc.live.proved, true, JSON.stringify(r.doc.live.differences));
  assert.deepEqual(r.doc.live.actual.tools, ["Bash"]);
  assert.equal(r.doc.shell.gitBash.how, "where-git");
  assert.equal(path.win32.normalize(r.doc.live.actual.bash).toLowerCase(), path.join(g1, "bin", "bash.exe").toLowerCase());
});

test("check --live: no Git Bash and the PowerShell tool off: the binary stops at start, the proof agrees, and the finding is an error", { skip: skip() || (HAS_DEFAULT_GIT && "Git at C:\\Program Files\\Git is found whatever the variable says"), timeout: 600000 }, async () => {
  const { w } = setup("live4");
  const r = await live(w, { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } });
  assert.equal(r.doc.live.proved, true, JSON.stringify(r.doc.live.differences));
  assert.equal(r.doc.live.exitCode, 1);
  assert.equal(r.doc.live.requests, 0);
  assert.deepEqual(r.doc.live.actual.tools, []);
  assert.equal(r.doc.findings[0].id, "no-shell-tool");
  assert.equal(r.code, 1);
});

test("check --live copies what the settings say about the shell: the PowerShell variable in the user settings, a deny rule for Bash, and not the rest", { skip: skip(), timeout: 600000 }, async () => {
  const { w, g1 } = setup("live5");
  const bash = path.join(g1, "bin", "bash.exe").replace(/\\/g, "/");
  w.user({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: bash, ANTHROPIC_API_KEY: "sk-ant-never-copied" }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node -e \"require('fs').writeFileSync(process.env.TEMP + '/cwd-hook-ran.txt','x')\"" }] }] } });
  const hookFile = path.join(process.env.TEMP || ".", "cwd-hook-ran.txt");
  fs.rmSync(hookFile, { force: true });
  const both = await live(w);
  assert.equal(both.doc.live.proved, true, JSON.stringify(both.doc.live.differences));
  assert.deepEqual(both.doc.live.actual.tools, ["Bash", "PowerShell"]);
  assert.ok(!fs.existsSync(hookFile), "a hook of the user's settings did not run: only the shell settings are copied");
  w.user({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: bash }, permissions: { deny: ["Bash"] } });
  const noBash = await live(w);
  assert.equal(noBash.doc.live.proved, true, JSON.stringify(noBash.doc.live.differences));
  assert.deepEqual(noBash.doc.live.actual.tools, ["PowerShell"]);
  w.user({ env: { CLAUDE_CODE_GIT_BASH_PATH: bash } });
  w.project({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } });
  const project = await live(w);
  assert.equal(project.doc.live.proved, true, JSON.stringify(project.doc.live.differences));
  assert.deepEqual(project.doc.live.actual.tools, ["Bash", "PowerShell"], "a project settings file counts for the PowerShell variable");
  assert.ok(!JSON.stringify(both.doc).includes("sk-ant-never-copied"));
});

test("check --live: a claude that is not there is said, and exit 1; with no claude on PATH and no --claude the ones that were found are named", { skip: skip(), timeout: 600000 }, async () => {
  const { w } = setup("live6");
  const sys = (() => { const e = { ...w.env }; setVar(e, "Path", SYSTEM_PATH); return makeSys({ env: e, cwd: w.work, home: w.home }); })();
  const missing = await run(["check", "--live", "--json", "--claude", path.join(w.base, "nope", "claude.exe"), "--project", w.work], { sys, userEnv: fileUserEnv(w.userEnvFile) });
  assert.equal(missing.code, 1);
  assert.match(JSON.parse(missing.out).live.error, /nope.claude\.exe is not a file/);
  const none = await run(["check", "--live", "--json", "--project", w.work], { sys, userEnv: fileUserEnv(w.userEnvFile) });
  assert.equal(none.code, 1);
  assert.match(JSON.parse(none.out).live.error, /^no claude on PATH to run \(pass --claude <path>/);
});
