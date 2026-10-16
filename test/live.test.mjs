// check --live: what is copied from your setup into the run, the fake API, and the whole run against a stand-in for the binary (test/fake-claude.mjs, run as a
// .cmd shim on Windows and as a shell script elsewhere); the comparison of what the binary listed with the prediction. The real binary is put to it in test/e2e-live.test.mjs.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IS_WIN, tmpDir } from "./helpers.mjs";
import { fakeMachine, SYSTEM_FILES, SYSTEM_PATH } from "./machine.mjs";
import { makeSys } from "../src/sys.mjs";
import { liveEnv, liveSettings, proveShell, runBinary, startFakeApi } from "../src/live.mjs";
import { makeLiveWorld } from "../src/write.mjs";

const FAKE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const facts = (o = {}) => ({ env: { managed: {}, local: {}, project: {}, user: {}, ...(o.env || {}) }, deny: o.deny || [], defaultShell: [] });

/** A claude for the tests: a .cmd shim on Windows, a shell script elsewhere; both start the stand-in with Node. */
function standIn() {
  const dir = tmpDir("cwd-standin-");
  if (IS_WIN) {
    const f = path.join(dir, "claude.cmd");
    fs.writeFileSync(f, `@"${process.execPath}" "${FAKE}" %*\r\n`);
    return f;
  }
  const f = path.join(dir, "claude");
  fs.writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

test("liveSettings copies the env of the two shell variables and the deny rules that take a whole shell tool away, and nothing else; managed settings go to the user file", () => {
  const s = liveSettings(facts({
    env: {
      user: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\a\\bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", ANTHROPIC_API_KEY: "sk-secret", HTTPS_PROXY: "http://p" },
      project: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\ignored\\bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "0", OTHER: "x" },
      local: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" },
      managed: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\m\\bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" },
    },
    deny: [{ scope: "user", rule: "Bash" }, { scope: "project", rule: "PowerShell(*)" }, { scope: "project", rule: "Bash(git *)" }, { scope: "user", rule: "Read(.env)" }, { scope: "managed", rule: "PowerShell" }],
  }));
  assert.deepEqual(s.user.env, { CLAUDE_CODE_GIT_BASH_PATH: "C:\\m\\bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, "managed values replace the user's in the file the run reads");
  assert.deepEqual(s.project.env, { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, "the Git Bash path of a project file is not used by Claude Code, so it is not copied");
  assert.deepEqual(s.local.env, { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" });
  assert.deepEqual(s.user.permissions.deny, ["Bash", "PowerShell"]);
  assert.deepEqual(s.project.permissions.deny, ["PowerShell(*)"]);
  const text = JSON.stringify(s);
  for (const never of ["sk-secret", "HTTPS_PROXY", "OTHER", "Read(.env)", "git *", "hooks", "apiKeyHelper", "statusLine"]) assert.ok(!text.includes(never), `${never} is not copied`);
  assert.deepEqual(liveSettings(facts()), {}, "nothing to copy: no file at all");
});

test("liveEnv: this machine's environment without every CLAUDE_*, ANTHROPIC_*, CLAUDECODE*, AI_AGENT, MCP_* and ENABLE_TOOL_SEARCH, plus the two shell variables as they are, updates and telemetry off, and the home and config folders of the run", () => {
  const sys = fakeMachine({ env: { Path: SYSTEM_PATH, Keep: "1", CLAUDE_CONFIG_DIR: "C:\\real\\.claude", ANTHROPIC_API_KEY: "sk-real", ANTHROPIC_BASE_URL: "https://real", CLAUDECODE: "1", AI_AGENT: "x", MCP_TIMEOUT: "1", ENABLE_TOOL_SEARCH: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:\\g\\bash.exe", claude_code_use_powershell_tool: "1", CLAUDE_EFFORT: "high", USERPROFILE: "C:\\real", HOME: "C:\\real" } });
  const world = { home: "C:\\run\\home", cfg: "C:\\run\\cfg" };
  const e = liveEnv(sys, world, 4321);
  assert.equal(e.CLAUDE_CODE_GIT_BASH_PATH, "C:\\g\\bash.exe");
  assert.equal(e.CLAUDE_CODE_USE_POWERSHELL_TOOL, "1", "found in any case, written in the case Claude Code reads");
  assert.deepEqual([e.HOME, e.USERPROFILE, e.CLAUDE_CONFIG_DIR], ["C:\\run\\home", "C:\\run\\home", "C:\\run\\cfg"]);
  assert.deepEqual([e.ANTHROPIC_BASE_URL, e.ANTHROPIC_API_KEY], ["http://127.0.0.1:4321", "sk-ant-probe"]);
  assert.deepEqual([e.DISABLE_AUTOUPDATER, e.DISABLE_TELEMETRY, e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, e.NO_COLOR], ["1", "1", "1", "1"]);
  assert.equal(e.Keep, "1");
  assert.equal(e.Path, SYSTEM_PATH);
  for (const gone of ["CLAUDECODE", "AI_AGENT", "MCP_TIMEOUT", "ENABLE_TOOL_SEARCH", "CLAUDE_EFFORT"]) assert.ok(!(gone in e), gone);
  assert.ok(!JSON.stringify(e).includes("sk-real") && !JSON.stringify(e).includes("https://real"));
  const none = liveEnv(fakeMachine({ env: { Path: "x" } }), world, 1);
  assert.ok(!("CLAUDE_CODE_GIT_BASH_PATH" in none) && !("CLAUDE_CODE_USE_POWERSHELL_TOOL" in none), "a variable that is not set stays unset");
});

test("startFakeApi listens on 127.0.0.1 only, records every request whole, answers a stream with the text PROBE-DONE, and answers a request that is not a stream with a message", async () => {
  const api = await startFakeApi();
  try {
    const post = (body, urlPath = "/v1/messages") => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: api.port, path: urlPath, method: "POST", headers: { "content-type": "application/json" } }, (res) => { let t = ""; res.on("data", (c) => { t += c; }); res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], text: t })); });
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
    const s = await post({ model: "m", stream: true, messages: [{ role: "user", content: "hi" }], tools: [{ name: "Bash" }] });
    assert.equal(s.status, 200);
    assert.match(s.type, /event-stream/);
    assert.match(s.text, /event: message_start/);
    assert.match(s.text, /PROBE-DONE/);
    assert.match(s.text, /event: message_stop/);
    const n = await post({ model: "m", stream: false, messages: [] });
    assert.match(n.type, /json/);
    assert.equal(JSON.parse(n.text).type, "message");
    assert.equal((await post({}, "/other")).status, 404);
    assert.equal(api.requests.length, 2, "the request to another path is not recorded");
    assert.deepEqual(api.requests[0].tools, [{ name: "Bash" }]);
  } finally { await api.close(); }
});

test("runBinary runs the binary in a throwaway world: scrubbed environment, the copied settings, the tools of its first request, its debug lines, its exit", async () => {
  const sys = makeSys({ env: { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: "C:\\g\\bash.exe", ANTHROPIC_API_KEY: "sk-real-secret", CLAUDE_EFFORT: "high", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } });
  const base = tmpDir("cwd-run-");
  const dump = path.join(base, "dump.json");
  process.env.FAKE_CLAUDE_DUMP = dump;
  process.env.FAKE_CLAUDE_TOOLS = "Bash,PowerShell";
  process.env.FAKE_CLAUDE_DEBUG = 'Using bash path: "C:/g/bash.exe"|something else';
  try {
    sys.env.FAKE_CLAUDE_DUMP = dump;
    sys.env.FAKE_CLAUDE_TOOLS = "Bash,PowerShell";
    sys.env.FAKE_CLAUDE_DEBUG = 'Using bash path: "C:/g/bash.exe"|something else';
    const r = await runBinary(sys, { claudePath: standIn(), base, facts: facts({ env: { user: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", ANTHROPIC_MODEL: "x" }, project: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }, deny: [{ scope: "user", rule: "Bash(*)" }] }) });
    assert.equal(r.ran, true);
    assert.equal(r.exitCode, 0);
    assert.deepEqual(r.shellTools, ["Bash", "PowerShell"]);
    assert.deepEqual(r.tools, ["Bash", "PowerShell", "Read"]);
    assert.equal(r.edition, "PowerShell 7+ (pwsh)");
    assert.equal(r.using, "C:/g/bash.exe");
    assert.equal(r.requests, 1);
    assert.equal(r.timedOut, false);
    const d = JSON.parse(fs.readFileSync(dump, "utf8"));
    assert.deepEqual(d.args.slice(0, 5), ["-p", "PROBE-MAIN hello", "--output-format", "json", "--debug-file"]);
    assert.equal(d.values.CLAUDE_CONFIG_DIR, path.join(base, "cfg"));
    assert.equal(d.values.HOME, path.join(base, "home"));
    assert.equal(d.values.USERPROFILE, path.join(base, "home"));
    assert.match(d.values.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(d.values.ANTHROPIC_API_KEY, "sk-ant-probe", "the key of the machine is not passed on");
    assert.equal(d.values.DISABLE_TELEMETRY, "1");
    assert.equal(d.values.DISABLE_AUTOUPDATER, "1");
    assert.equal(d.values.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
    assert.equal(d.values.CLAUDE_CODE_GIT_BASH_PATH, "C:\\g\\bash.exe", "the shell variable of this process");
    assert.ok(!d.names.includes("CLAUDE_EFFORT"));
    assert.ok(!JSON.stringify(d).includes("sk-real-secret"));
    assert.equal(d.cwd, path.join(base, "work"), "the working folder is the throwaway project, not yours");
    assert.deepEqual(d.userSettings, { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, permissions: { deny: ["Bash(*)"] } });
    assert.deepEqual(d.projectSettings, { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } });
    assert.equal(d.localSettings, null);
    assert.equal(d.claudeJson.hasCompletedOnboarding, true);
    assert.equal(d.claudeJson.projects[path.join(base, "work")].hasTrustDialogAccepted, true);
  } finally {
    for (const k of ["FAKE_CLAUDE_DUMP", "FAKE_CLAUDE_TOOLS", "FAKE_CLAUDE_DEBUG"]) delete process.env[k];
  }
});

test("runBinary: a binary that stops at start (exit 1, a line on stderr, no request), and a path that cannot be started", async () => {
  const sys = makeSys({ env: { ...process.env, FAKE_CLAUDE_EXIT: "1" } });
  const r = await runBinary(sys, { claudePath: standIn(), base: tmpDir("cwd-run-"), facts: facts() });
  assert.equal(r.ran, true);
  assert.equal(r.exitCode, 1);
  assert.equal(r.requests, 0);
  assert.deepEqual(r.shellTools, []);
  assert.match(r.stderr, /^Claude Code on Windows requires a shell tool/);
  const gone = await runBinary(makeSys(), { claudePath: path.join(tmpDir("cwd-none-"), IS_WIN ? "nope.exe" : "nope"), base: tmpDir("cwd-run-"), facts: facts() });
  assert.equal(gone.ran, false);
  assert.match(gone.error, /could not be started \(ENOENT\)/);
});

test("makeLiveWorld is what runBinary builds in: nothing of the user's is in it", () => {
  const w = makeLiveWorld(tmpDir("cwd-w-"), { settings: liveSettings(facts({ env: { user: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } })) });
  assert.deepEqual(fs.readdirSync(w.cfg).sort(), [".claude.json", "settings.json"]);
  assert.deepEqual(fs.readdirSync(w.work), []);
  assert.deepEqual(fs.readdirSync(w.home), []);
});

// the comparison, with a stub that says what the binary did
const sysFor = (files, env) => fakeMachine({ env: { Path: SYSTEM_PATH, SystemRoot: "C:\\Windows", ...env }, files: [...SYSTEM_FILES, ...files] });
const stub = (o) => async () => ({ ran: true, exitCode: 0, timedOut: false, requests: 1, tools: [], shellTools: [], edition: null, using: null, warning: null, notFound: false, stderr: "", cwd: "C:\\run\\work", ...o });

test("proveShell: what the binary listed is what was predicted, down to the bash.exe it took, and says so", async () => {
  const sys = sysFor(["C:\\g\\bin\\bash.exe"], { CLAUDE_CODE_GIT_BASH_PATH: "C:\\g\\bin\\bash.exe" });
  const ok = await proveShell(sys, { claudePath: "C:\\x\\claude.exe", base: "C:\\run", facts: facts(), version: "2.1.299", runner: stub({ shellTools: ["Bash"], using: "C:\\g\\bin\\bash.exe" }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.proved, true);
  assert.deepEqual(ok.differences, []);
  assert.deepEqual(ok.predicted, { tools: ["Bash"], exit: 0, bash: "C:\\g\\bin\\bash.exe", how: "variable" });
  assert.equal(ok.claude.version, "2.1.299");
  const noGit = await proveShell(sysFor([], {}), { claudePath: "x", base: "y", facts: facts(), runner: stub({ shellTools: ["PowerShell"] }) });
  assert.equal(noGit.proved, true, "PowerShell only, no bash taken");
  const stops = await proveShell(sysFor([], { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }), { claudePath: "x", base: "y", facts: facts(), runner: stub({ exitCode: 1, requests: 0 }) });
  assert.equal(stops.proved, true, "Claude Code stops at start, as predicted");
});

test("proveShell: every kind of difference is named", async () => {
  const sys = sysFor(["C:\\g\\bin\\bash.exe", "C:\\h\\bin\\bash.exe"], { CLAUDE_CODE_GIT_BASH_PATH: "C:\\g\\bin\\bash.exe" });
  const a = await proveShell(sys, { claudePath: "x", base: "y", facts: facts(), runner: stub({ shellTools: ["PowerShell"] }) });
  assert.equal(a.proved, false);
  assert.match(a.differences[0], /the binary listed PowerShell; the prediction was Bash/);
  const b = await proveShell(sys, { claudePath: "x", base: "y", facts: facts(), runner: stub({ shellTools: ["Bash"], using: "C:\\h\\bin\\bash.exe" }) });
  assert.match(b.differences[0], /the binary took C:\\h\\bin\\bash\.exe; the prediction was C:\\g\\bin\\bash\.exe/);
  const c = await proveShell(sys, { claudePath: "x", base: "y", facts: facts(), runner: stub({ exitCode: 1, shellTools: [] }) });
  assert.ok(c.differences.some((d) => /the binary exited with code 1; the prediction was 0/.test(d)));
  const d = await proveShell(sysFor([], {}), { claudePath: "x", base: "y", facts: facts(), runner: stub({ shellTools: ["PowerShell"], using: "C:\\z\\bash.exe" }) });
  assert.match(d.differences[0], /the binary took C:\\z\\bash\.exe; the prediction found no Git Bash/);
  const e = await proveShell(sys, { claudePath: "x", base: "y", facts: facts(), runner: async () => ({ ran: false, error: "claude.exe could not be started (EACCES)" }) });
  assert.deepEqual([e.ok, e.error], [false, "claude.exe could not be started (EACCES)"]);
  const same = await proveShell(sys, { claudePath: "x", base: "y", facts: facts(), runner: stub({ shellTools: ["Bash"], using: "c:/G/BIN/bash.exe" }) });
  assert.equal(same.proved, true, "the same file in another spelling is the same file");
});
