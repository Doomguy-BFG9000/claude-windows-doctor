// Checks against the real Claude Code binary (run only when E2E_CLAUDE points at one) about the plugin:
//   the plugin validates (also with --strict);
//   the user-only skill adds nothing to a request that does not use it;
//   /windows-doctor:check hands the model the short report for the project, whichever way Claude Code runs the command line, and what it costs is measured
//   (the README's "What it costs in tokens");
//   a skill whose command exits 1 never reaches the model, which is why `check --markdown` always exits 0;
//   the skill's allowed-tools let the model run the command with no prompt (the Bash tool, and the PowerShell tool on Windows);
//   the plugin's own cost projection (claude plugin details) is small.
// The fake API on 127.0.0.1 answers; no token is spent, and every run has its own throwaway HOME, USERPROFILE and CLAUDE_CONFIG_DIR.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, tmpDir } from "./helpers.mjs";
import { IS_WIN, claudeInfo, fakeApi, mainRequest, put, runClaude, sandbox, setVar, skip, textBlocks } from "./claude-sandbox.mjs";

const fwd = (p) => p.replace(/\\/g, "/");
const withSkill = (api) => api.requests.find((r) => textBlocks(r).some((b) => b.startsWith("Base directory for this skill")));
const SYSROOT = process.env.SystemRoot || "C:\\Windows";
// a PATH that has Node (the skill runs `node`) and the system folders, and nothing else of this machine's
const NODE_DIR = path.dirname(process.execPath);
const PATH_ENV = IS_WIN ? [NODE_DIR, path.win32.join(SYSROOT, "System32"), SYSROOT].join(";") : `${NODE_DIR}:/usr/bin:/bin`;

/** The environment of a run of the skill: the PATH above and a file for the user environment with `n` variables that only the registry would have. */
function skillEnv(sb, n, { long = false } = {}) {
  const names = ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR", "CLAUDE_ENV_FILE", "CLAUDE_CODE_PLUGIN_CACHE_DIR", "CLAUDE_CODE_PLUGIN_SEED_DIR", "CLAUDE_X1_DIR", "CLAUDE_X2_DIR", "CLAUDE_X3_DIR", "CLAUDE_X4_DIR", "CLAUDE_X5_DIR", "CLAUDE_X6_DIR", "CLAUDE_X7_DIR", "CLAUDE_X8_DIR", "CLAUDE_X9_DIR"];
  const file = path.join(sb.root, "user-env.json");
  put(file, Object.fromEntries(names.slice(0, n).map((k) => [k, { type: "REG_SZ", value: long ? `D:\\${"a-long-folder-name-".repeat(14)}${k}` : `D:\\data\\${k.toLowerCase()}` }])));
  const e = { CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE: file, CLAUDE_WINDOWS_DOCTOR_MANAGED_DIR: path.join(sb.root, "no-managed") };
  setVar(e, IS_WIN ? "Path" : "PATH", PATH_ENV);
  return e;
}

test("claude plugin validate and --strict pass", { skip: skip(), timeout: 300000 }, async () => {
  const sb = sandbox("validate");
  for (const args of [["plugin", "validate", ROOT], ["plugin", "validate", ROOT, "--strict"]]) {
    const r = await runClaude(sb, null, args, { timeout: 120000 });
    assert.equal(r.code, 0, `${args.join(" ")}\n${r.out}${r.err}`);
  }
});

test("the user-only skill adds nothing to a request that does not use it: no tool, no skill list entry, no word of it", { skip: skip(), timeout: 300000 }, async (t) => {
  const sb = sandbox("always");
  const without = await fakeApi();
  const withPlugin = await fakeApi();
  try {
    await runClaude(sb, without, ["-p", "PROBE-MAIN hello", "--output-format", "json"], { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: IS_WIN ? "1" : undefined } });
    await runClaude(sb, withPlugin, ["-p", "PROBE-MAIN hello", "--plugin-dir", ROOT, "--output-format", "json"], { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: IS_WIN ? "1" : undefined } });
    const plain = (r) => JSON.stringify(r).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?Z?/g, "<time>");
    const a = plain(mainRequest(without));
    const b = plain(mainRequest(withPlugin));
    assert.ok(!b.includes("windows-doctor"), "nothing of the plugin is in the request");
    assert.ok(!b.includes("Check the Windows setup"), "not even the skill's description");
    assert.equal(JSON.stringify(mainRequest(withPlugin).tools), JSON.stringify(mainRequest(without).tools), "the tool list is the same");
    assert.equal(b.length, a.length, "the request has the same size with the plugin loaded");
    t.diagnostic(`plain prompt: ${a.length} characters without the plugin, ${b.length} with it; the string windows-doctor appears ${b.split("windows-doctor").length - 1} times`);
  } finally { await without.close(); await withPlugin.close(); }
});

test("/windows-doctor:check hands the model the report for the project, whichever way Claude Code runs the command line, and what it costs is measured", { skip: skip(), timeout: 600000 }, async (t) => {
  const figures = {};
  for (const [label, n, long] of [["typical", 3, false], ["at the cap", 14, true]]) {
    const sb = sandbox(`skill-${n}`);
    const env = skillEnv(sb, n, { long });
    const a1 = await fakeApi();
    try {
      const r = await runClaude(sb, a1, ["-p", "/windows-doctor:check", "--plugin-dir", ROOT, "--output-format", "json"], { env });
      assert.equal(r.code, 0, r.err);
      assert.ok(withSkill(a1), "the skill reached the model, although the report holds findings (its command must not fail)");
      const blocks = textBlocks(withSkill(a1));
      const skillText = blocks.find((b) => b.startsWith("Base directory for this skill"));
      const commandText = blocks.find((b) => b.includes("<command-name>/windows-doctor:check</command-name>"));
      assert.match(skillText, /At most 10 lines: the shell the Bash tool gets and why in one line, then each problem with its fix\./);
      assert.match(skillText, /Edit nothing until the user agrees\./);
      assert.ok(!skillText.includes("${CLAUDE_"), "no variable is left unexpanded");
      let report = "";
      if (/run this first/.test(skillText)) {
        assert.ok(skillText.includes(`bin/claude-windows-doctor.mjs" check --project "${fwd(sb.work)}" --markdown`), `the command, with the plugin folder and the project folder filled in:\n${skillText}`);
        figures[label] = { how: "run this first", skill: skillText.length, command: commandText ? commandText.length : 0 };
      } else {
        report = skillText.slice(skillText.indexOf("## windows-doctor check"), skillText.indexOf("At most 10 lines"));
        assert.ok(report.includes("## windows-doctor check"), skillText);
        figures[label] = { how: "output pasted", skill: skillText.length, command: commandText ? commandText.length : 0, report: report.length, findings: report.split("\n").filter((l) => l.startsWith("- ")).length, lines: report.trim().split("\n").length };
      }
    } finally { await a1.close(); }
  }
  t.diagnostic(`Claude Code ${claudeInfo().number}: ${JSON.stringify(figures)}`);
  for (const f of Object.values(figures)) assert.ok(f.skill + f.command < 8000);
});

test("the report that the model gets from the command, measured: 3 findings, and the cap (14 findings, long paths), through the Bash tool or the PowerShell tool as allowed-tools permits, with no prompt", { skip: skip(), timeout: 900000 }, async (t) => {
  const figures = {};
  const tool = IS_WIN ? "PowerShell" : "Bash";
  for (const [label, n, long] of [["typical", 3, false], ["at the cap", 14, true]]) {
    const sb = sandbox(`allowed-${n}`);
    const env = { ...skillEnv(sb, n, { long }) };
    if (IS_WIN) setVar(env, "CLAUDE_CODE_USE_POWERSHELL_TOOL", "1");
    const command = `node "${fwd(ROOT)}/bin/claude-windows-doctor.mjs" check --project "${fwd(sb.work)}" --markdown`;
    const api = await fakeApi([{ tool, input: { command, description: "Run the check" } }]);
    try {
      const r = await runClaude(sb, api, ["-p", "/windows-doctor:check", "--plugin-dir", ROOT, "--output-format", "json", "--permission-mode", "default", "--max-turns", "3"], { env });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.result.permission_denials, [], "nothing was refused: the command of the skill is allowed with no prompt");
      const seen = new Map();
      for (const b of api.requests.flatMap((rq) => rq.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []))) if (b.type === "tool_result") seen.set(b.tool_use_id, b);
      const [res] = [...seen.values()];
      assert.ok(res, "the command ran");
      const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      assert.match(text, /## windows-doctor check/);
      const lines = text.trim().split("\n");
      figures[label] = { chars: text.length, lines: lines.length, findings: lines.filter((l) => l.startsWith("- ")).length };
      if (!IS_WIN) {
        // on Linux and macOS there is nothing to check: the Bash tool ran the command with no prompt, and the answer is the two lines
        assert.match(text, /^## windows-doctor check\nNothing to check on (Linux|macOS): /);
        assert.equal(lines.length, 2);
        continue;
      }
      if (label === "at the cap") {
        assert.equal(lines.filter((l) => l.startsWith("- WARNING")).length, 12);
        assert.match(lines.at(-1), /^- \.\.\. and \d+ more \(run `claude-windows-doctor check`\)$/);
        assert.ok(lines.length <= 17, `${lines.length} lines`);
        for (const l of lines) assert.ok(l.length <= 500, `${l.length} characters in a line`);
      } else assert.ok(figures[label].findings >= 3 && figures[label].findings <= 6, `${figures[label].findings} findings (3 variables of the user environment, and what this machine adds):\n${text}`);
    } finally { await api.close(); }
  }
  t.diagnostic(`the report through the ${tool} tool on Claude Code ${claudeInfo().number}: ${JSON.stringify(figures)}`);
});

test("a skill whose command line exits 1 never reaches the model, and the same skill with a command that exits 0 does: why check --markdown always exits 0", { skip: skip(), timeout: 600000 }, async (t) => {
  const seen = {};
  for (const [variant, id] of [["a command that exits 1", "no-such-finding"], ["a command that exits 0", "code-page"]]) {
    const sb = sandbox("failskill");
    const plug = path.join(sb.root, "plug");
    fs.mkdirSync(path.join(plug, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(plug, "skills", "check"), { recursive: true });
    fs.writeFileSync(path.join(plug, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "wd-fail", version: "1.0.0", description: "a copy of the skill whose command exits 0 or 1" }));
    const line = `node "${fwd(ROOT)}/bin/claude-windows-doctor.mjs" explain ${id}`;
    fs.writeFileSync(path.join(plug, "skills", "check", "SKILL.md"), ["---", "name: check", "description: Check the Windows setup.", "disable-model-invocation: true", "allowed-tools: Bash(node *) PowerShell(node *)", "---", "", `!\`${line}\``, "", "In at most 10 lines: say what it is.", ""].join("\n"));
    const api = await fakeApi();
    try {
      const r = await runClaude(sb, api, ["-p", "/wd-fail:check", "--plugin-dir", plug, "--output-format", "json", "--permission-mode", "default"], { env: { [IS_WIN ? "Path" : "PATH"]: PATH_ENV, ...(IS_WIN ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } : {}) } });
      assert.equal(r.code, 0, r.err);
      seen[variant] = { requests: api.requests.length, reached: Boolean(withSkill(api)) };
    } finally { await api.close(); }
  }
  t.diagnostic(`a skill whose command exits 1: ${seen["a command that exits 1"].requests} requests reached the model; with a command that exits 0: ${seen["a command that exits 0"].requests}`);
  assert.equal(seen["a command that exits 0"].reached, true, "the output reaches the model");
  assert.equal(seen["a command that exits 1"].reached, false, "a command that exits 1 drops the skill");
});

test("installed from a marketplace, the plugin's own cost projection is small and its skill is one user-only skill", { skip: skip(), timeout: 600000 }, async (t) => {
  const sb = sandbox("details");
  const mkt = path.join(sb.root, "mkt");
  const dest = path.join(mkt, "plugins", "windows-doctor");
  fs.mkdirSync(path.join(mkt, ".claude-plugin"), { recursive: true });
  for (const item of ["bin", "src", "skills", ".claude-plugin", "package.json"]) fs.cpSync(path.join(ROOT, item), path.join(dest, item), { recursive: true });
  fs.writeFileSync(path.join(mkt, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "local-test", owner: { name: "test" }, plugins: [{ name: "windows-doctor", description: "x", source: "./plugins/windows-doctor" }] }));
  const claude = (...args) => runClaude(sb, null, args, { timeout: 150000 });
  const added = await claude("plugin", "marketplace", "add", mkt);
  assert.equal(added.code, 0, added.out + added.err);
  const installed = await claude("plugin", "install", "windows-doctor@local-test");
  assert.equal(installed.code, 0, installed.out + installed.err);
  const details = await claude("plugin", "details", "windows-doctor");
  assert.equal(details.code, 0, details.out + details.err);
  assert.match(details.out, /Skills \(1\)\s+check/);
  assert.match(details.out, /Hooks \(0\)/);
  const always = /Always-on:\s+~(\d+) tok/.exec(details.out);
  assert.ok(always && Number(always[1]) < 30, `always-on is ${always && always[1]} tokens`);
  const row = /^\s*check\s+.*$/m.exec(details.out);
  t.diagnostic(`claude plugin details on ${claudeInfo().number}: ${always[0].replace(/\s+/g, " ")}; per component: ${row ? row[0].trim().replace(/\s+/g, " ") : "(no row)"}`);
});

test("when the shell tool is not allowed for the command, Claude Code hands the model the command line as 'run this first', and the skill text reads right that way too (Windows, PowerShell tool)", { skip: skip() || (!IS_WIN && "this is how the PowerShell tool of a Windows setup behaves here"), timeout: 300000 }, async () => {
  const copy = path.join(tmpDir("cwd-plug-"), "plugin");
  for (const item of ["bin", "src", "skills", ".claude-plugin", "package.json"]) fs.cpSync(path.join(ROOT, item), path.join(copy, item), { recursive: true });
  const skillFile = path.join(copy, "skills", "check", "SKILL.md");
  // a checkout on Windows may have turned the line feeds into CRLF
  const text = fs.readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
  assert.match(text, /^allowed-tools: .*\n/m);
  fs.writeFileSync(skillFile, text.replace(/^allowed-tools: .*\n/m, ""));
  const sb = sandbox("runfirst");
  const api = await fakeApi();
  try {
    const r = await runClaude(sb, api, ["-p", "/windows-doctor:check", "--plugin-dir", copy, "--output-format", "json"], { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/nonexistent/bash.exe" } });
    assert.equal(r.code, 0, r.err);
    const skillText = textBlocks(withSkill(api) || mainRequest(api)).find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText, "the skill reached the model");
    assert.match(skillText, /\[run this first, exactly as written, with the PowerShell tool and use its output: `node "[^"]+claude-windows-doctor\.mjs" check --project "[^"]+" --markdown`\]\n\nAt most 10 lines: the shell the Bash tool gets/);
    assert.ok(skillText.includes(`--project "${fwd(sb.work)}"`), "the project folder is filled in");
  } finally { await api.close(); }
});

test("on Linux and macOS the skill's command runs at prompt time and pastes its answer: nothing to check", { skip: skip() || (IS_WIN && "Windows"), timeout: 300000 }, async () => {
  const sb = sandbox("nothing");
  const api = await fakeApi();
  try {
    const r = await runClaude(sb, api, ["-p", "/windows-doctor:check", "--plugin-dir", ROOT, "--output-format", "json"], { env: { Path: PATH_ENV, PATH: PATH_ENV } });
    assert.equal(r.code, 0, r.err);
    const skillText = textBlocks(withSkill(api) || mainRequest(api)).find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText);
    if (!/run this first/.test(skillText)) assert.match(skillText, /## windows-doctor check\nNothing to check on (Linux|macOS): /);
  } finally { await api.close(); }
});
