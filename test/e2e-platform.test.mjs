// Checks against the real Claude Code binary (run only when E2E_CLAUDE points at one, and only on Windows) for what the explain pages and the findings say that
// Claude Code does about the platform: the execution policy that its PowerShell sees, the line endings of what its tools write, the code page of what the
// Bash and the PowerShell tools print, a path of more than 260 characters, the words it stops with when there is no shell tool, what the PowerShell tool's
// description says of the two editions, and what `claude doctor` says. The fake API on 127.0.0.1 answers; no token is spent.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claudeInfo, fakeApi, mainRequest, put, runClaude, sandbox, skipUnlessWindows } from "./claude-sandbox.mjs";
import { effectivePolicy, parseExecutionPolicy } from "../src/facts.mjs";
import { makeSys } from "../src/sys.mjs";
import { discoverGitBash } from "../src/gitbash.mjs";
import { FIXED_BASH } from "../src/shell.mjs";

// a Git Bash for the runs that use the Bash tool: this machine's (found the way `fix` finds it) or the default one
const GIT = (() => {
  if (process.platform !== "win32") return null;
  const d = FIXED_BASH.find((p) => fs.existsSync(p));
  if (d) return d;
  const found = discoverGitBash(makeSys(), { cwd: process.cwd() });
  return found.length ? found[0].path : null;
})();
const SHELLS = { CLAUDE_CODE_GIT_BASH_PATH: GIT ? GIT.replace(/\\/g, "/") : "C:/nonexistent/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" };

/** The text of every tool result of a run, in order of the tool calls. */
function results(api) {
  const seen = new Map();
  for (const rq of api.requests) for (const m of rq.messages || []) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") seen.set(b.tool_use_id, b);
  return [...seen.values()].map((b) => (typeof b.content === "string" ? b.content : JSON.stringify(b.content)));
}
async function go(sb, calls, { env = {}, args = [] } = {}) {
  const api = await fakeApi(calls);
  try {
    const r = await runClaude(sb, api, ["-p", "PROBE-MAIN hello", "--output-format", "json", "--permission-mode", "bypassPermissions", "--max-turns", "8", "--debug-file", sb.debug, ...args], { env: { ...SHELLS, ...env } });
    return { r, api, results: results(api) };
  } finally { await api.close(); }
}
const hookFor = (file) => ({ hooks: { SessionStart: [{ hooks: [{ type: "command", shell: "powershell", command: `Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + '=' + $_.ExecutionPolicy.ToString() } | Set-Content -Path '${file}'` }] }] } });
const LIST_CMD = "Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + '=' + $_.ExecutionPolicy.ToString() }";

test("the execution policy: a PowerShell hook and the PowerShell tool both run with -ExecutionPolicy Bypass at process scope; CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY, in the environment or in the user settings, takes it away", { skip: skipUnlessWindows(), timeout: 600000 }, async (t) => {
  const seen = {};
  for (const [label, env, settings] of [["default", {}, null], ["respect, in the environment", { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "1" }, null], ["respect, in the user settings", {}, { env: { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "1" } }]]) {
    const sb = sandbox("policy");
    const file = path.join(sb.root, "policy.txt");
    put(sb.user, { ...hookFor(file), ...(settings || {}) });
    const run = await go(sb, [{ tool: "PowerShell", input: { command: LIST_CMD } }], { env });
    assert.equal(run.r.code, 0, run.r.err);
    const hook = parseExecutionPolicy(fs.readFileSync(file, "utf8"));
    const tool = parseExecutionPolicy(run.results[0]);
    assert.equal(hook.length, 5, `${label}: the hook ran`);
    assert.deepEqual(tool, hook, `${label}: the hook and the tool see the same policies`);
    const process_ = hook.find((x) => x.scope === "Process").policy;
    seen[label] = process_;
    if (label === "default") {
      assert.equal(process_, "Bypass");
      // the prediction for this list, from what the machine says without Claude Code's bypass
      assert.equal(effectivePolicy(hook.map((x) => (x.scope === "Process" ? { ...x, policy: "Undefined" } : x))).policy, "Bypass");
    } else {
      assert.equal(process_, "Undefined", `${label}: no bypass`);
      assert.equal(effectivePolicy(hook, { respect: true }).scope === "Process", false);
    }
  }
  t.diagnostic(`Process scope seen by a hook and by the PowerShell tool on Claude Code ${claudeInfo().number}: ${JSON.stringify(seen)}`);
});

test("line endings: the Write tool wrote a new file with LF only, and the Edit tool kept the CRLF of a file it changed", { skip: skipUnlessWindows(), timeout: 300000 }, async () => {
  const sb = sandbox("eol");
  const fresh = path.join(sb.work, "new.txt");
  const old = path.join(sb.work, "crlf.txt");
  fs.writeFileSync(old, "alpha\r\nbeta\r\ngamma\r\n");
  const run = await go(sb, [
    { tool: "Write", input: { file_path: fresh, content: "one\ntwo\nthree\n" } },
    { tool: "Read", input: { file_path: old } },
    { tool: "Edit", input: { file_path: old, old_string: "beta", new_string: "BETA" } },
  ], { args: ["--permission-mode", "bypassPermissions"] });
  assert.equal(run.r.code, 0, run.r.err);
  assert.equal(fs.readFileSync(fresh, "latin1"), "one\ntwo\nthree\n");
  assert.equal(fs.readFileSync(old, "latin1"), "alpha\r\nBETA\r\ngamma\r\n");
});

test("the code page: cmd.exe /c dir through the Bash tool prints replacement characters when the console is not UTF-8, and through the PowerShell tool it is right (65001)", { skip: skipUnlessWindows() || (!GIT && "no Git Bash on this machine"), timeout: 300000 }, async (t) => {
  const sb = sandbox("cp");
  fs.writeFileSync(path.join(sb.work, "caf\u00e9-\u00fcber.txt"), "x");
  const run = await go(sb, [
    { tool: "Bash", input: { command: "MSYS_NO_PATHCONV=1 cmd.exe /c chcp" } },
    { tool: "Bash", input: { command: "MSYS_NO_PATHCONV=1 cmd.exe /c dir /b" } },
    { tool: "Bash", input: { command: "ls" } },
    { tool: "PowerShell", input: { command: "cmd.exe /c dir /b" } },
    { tool: "PowerShell", input: { command: "cmd.exe /c chcp" } },
  ]);
  assert.equal(run.r.code, 0, run.r.err);
  const [bashChcp, bashDir, bashLs, psDir, psChcp] = run.results;
  const page = Number(/(\d{3,5})\s*$/m.exec(bashChcp)[1]);
  t.diagnostic(`code page seen by the Bash tool: ${page}; by the PowerShell tool: ${/(\d{3,5})\s*$/m.exec(psChcp)[1]}; Bash cmd /c dir printed ${JSON.stringify(bashDir.trim())}`);
  assert.match(bashLs, /caf\u00e9-\u00fcber\.txt/, "a Git program prints UTF-8");
  assert.match(psDir, /caf\u00e9-\u00fcber\.txt/, "the PowerShell tool prints the file name right");
  assert.equal(Number(/(\d{3,5})\s*$/m.exec(psChcp)[1]), 65001, "the PowerShell tool sets UTF-8");
  if (page !== 65001) { assert.ok(bashDir.includes("\ufffd"), "a console that is not UTF-8: replacement characters"); assert.ok(!bashDir.includes("caf\u00e9")); } else assert.match(bashDir, /caf\u00e9-\u00fcber\.txt/);
});

test("long paths: the Write tool wrote a file at a path of more than 300 characters", { skip: skipUnlessWindows(), timeout: 300000 }, async (t) => {
  const sb = sandbox("long");
  const deep = path.join(sb.work, ...Array.from({ length: 6 }, (_, i) => `a-rather-long-directory-name-number-${i}-padding-padding`));
  const file = path.join(deep, "file.txt");
  assert.ok(file.length > 300, `${file.length} characters`);
  const run = await go(sb, [{ tool: "Write", input: { file_path: file, content: "hello\n" } }]);
  assert.equal(run.r.code, 0, run.r.err);
  assert.match(run.results[0], /File created successfully/);
  assert.equal(fs.readFileSync(`\\\\?\\${file}`, "utf8"), "hello\n");
  t.diagnostic(`a path of ${file.length} characters was written on Claude Code ${claudeInfo().number}`);
});

test("with no Git Bash and the PowerShell tool off, Claude Code stops at start and says so in these words", { skip: skipUnlessWindows() || (GIT && FIXED_BASH.some((p) => fs.existsSync(p)) && "Git at C:\\Program Files\\Git is found whatever the variable says"), timeout: 120000 }, async () => {
  const sb = sandbox("stop");
  const api = await fakeApi();
  try {
    const sysRoot = process.env.SystemRoot || "C:\\Windows";
    const r = await runClaude(sb, api, ["-p", "PROBE-MAIN hello", "--output-format", "json"], { env: { Path: [path.join(sysRoot, "System32"), sysRoot].join(";"), CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } });
    assert.equal(r.code, 1);
    assert.equal(api.requests.length, 0, "no request");
    assert.match(r.err, /Claude Code on Windows requires a shell tool\. Git Bash was not found and the PowerShell tool is disabled \(CLAUDE_CODE_USE_POWERSHELL_TOOL=0\)\./);
    assert.match(r.err, /Install Git for Windows/);
    assert.match(r.err, /Remove CLAUDE_CODE_USE_POWERSHELL_TOOL from your environment or settings/);
  } finally { await api.close(); }
});

test("the PowerShell tool's description says which edition it runs, and what the model may use there", { skip: skipUnlessWindows(), timeout: 300000 }, async () => {
  const sb = sandbox("edition");
  const api = await fakeApi();
  try {
    const sysRoot = process.env.SystemRoot || "C:\\Windows";
    const dirs = [path.join(sysRoot, "System32"), sysRoot];
    const r = await runClaude(sb, api, ["-p", "PROBE-MAIN hello", "--output-format", "json"], { env: { Path: dirs.join(";"), CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: SHELLS.CLAUDE_CODE_GIT_BASH_PATH } });
    assert.equal(r.code, 0, r.err);
    const tool = mainRequest(api).tools.find((x) => x.name === "PowerShell");
    const edition = /PowerShell edition: ([^\n]*)/.exec(tool.description)[1];
    if (/Windows PowerShell 5\.1/.test(edition)) assert.match(tool.description, /Pipeline chain operators `&&` and `\|\|` are NOT available/);
    else { assert.match(edition, /^PowerShell 7\+ \(pwsh\)$/); assert.match(tool.description, /Pipeline chain operators `&&` and `\|\|` ARE available/); }
  } finally { await api.close(); }
});

test("claude doctor, in a throwaway world: a native install whose folder is not on PATH is said so, and feature flags are said to be off with the variables of the oracle", { skip: skipUnlessWindows(), timeout: 300000 }, async (t) => {
  const sb = sandbox("doctor");
  const r = await runClaude(sb, null, ["doctor"], { timeout: 180000 });
  const text = `${r.out}${r.err}`.replace(/\x1b\[[0-9;]*m/g, "");
  t.diagnostic(`claude doctor on ${claudeInfo().number}: ${text.split("\n").filter((l) => /PATH|Feature-flag|flag/i.test(l)).map((l) => l.trim()).join(" | ")}`);
  assert.equal(r.code, 0, text);
  assert.match(text, /Feature-flag evaluation disabled \(disabled by CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC\)/);
  // only an install that is not from npm (the desktop app's bundle, the native installer) has a folder that doctor wants on PATH
  if (/^Running: npm/m.test(text)) assert.doesNotMatch(text, /not in your PATH/i, "an npm install has no such line");
  else assert.match(text, /Native installation exists but .* is not in your PATH/i);
});
