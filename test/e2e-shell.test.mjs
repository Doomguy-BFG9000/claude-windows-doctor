// Checks against the real Claude Code binary (run only when E2E_CLAUDE points at one, and only on Windows): which shell tools the first
// request lists. Every row of test/shell-table.mjs is built on a real disk (the fake Git trees, PATH, variables, settings), put to the
// binary through a fake Messages API on 127.0.0.1, and the answer must be the one the table records and the one that `predictShell`
// gives for the same machine. The binary's debug log says which bash.exe it took and why it ignored a variable. No token is spent,
// and every run has its own throwaway HOME, USERPROFILE and CLAUDE_CONFIG_DIR.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EDITIONS, ROWS } from "./shell-table.mjs";
import { envOf, fill, pathDirsOf, rowFiles, settingsOf } from "./table-lib.mjs";
import { claudeInfo, editionOf, probeRun, put, sandbox, setVar, shellTools, skipUnlessWindows } from "./claude-sandbox.mjs";
import { makeSys } from "../src/sys.mjs";
import { loadSettingsFiles, shellFacts } from "../src/settings.mjs";
import { FIXED_BASH, checkBashValue, expectedTools, predictShell } from "../src/shell.mjs";
import * as W from "../src/winpath.mjs";

const fwd = (p) => String(p).replace(/\\/g, "/");
const root = process.env.SystemRoot || "C:\\Windows";
const SYSTEM_PATH = [path.win32.join(root, "System32"), root, path.win32.join(root, "System32", "Wbem")].join(";");
const HAS_DEFAULT_GIT = process.platform === "win32" && FIXED_BASH.some((p) => fs.existsSync(p));
const pf = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files";
const HAS_DEFAULT_PWSH = process.platform === "win32" && fs.existsSync(path.win32.join(pf, "PowerShell", "7", "pwsh.exe"));

/** Builds a row on the real disk and returns what the run needs. */
function build(row, label) {
  const sb = sandbox(label);
  const ctx = { root: fwd(path.join(sb.root, "layouts")), work: fwd(sb.work) };
  const { files, dirs } = rowFiles(row, ctx);
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  for (const f of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const s = settingsOf(row, ctx);
  if (s.user) put(sb.user, s.user);
  if (s.project) put(sb.project, s.project);
  if (s.local) put(sb.local, s.local);
  const env = envOf(row, ctx);
  env.Path = [...pathDirsOf(row, ctx), SYSTEM_PATH].join(";");
  return { sb, ctx, env };
}

/** What predictShell says for the environment a run had (the real machine, read through the real `sys`). */
function predictOn(sb, runEnv) {
  const env = { ...runEnv };
  const sys = makeSys({ env, cwd: sb.work, home: runEnv.USERPROFILE || sb.home });
  const settings = loadSettingsFiles(sys, { project: sb.work, registry: false });
  return predictShell(sys, { cwd: sb.work, facts: shellFacts(settings) });
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

const applies = (row) => !row.defaultGit || (row.defaultGit === "present") === HAS_DEFAULT_GIT;

test("every row of the table: the binary lists the tools the table records, exits as it records, and took the bash.exe that the prediction names", { skip: skipUnlessWindows(), timeout: 1800000 }, async (t) => {
  const rows = ROWS.filter(applies);
  const outcomes = await pool(rows, 4, async (row) => {
    const { sb, env } = build(row, row.id.slice(0, 18));
    const run = await probeRun(sb, { env });
    const prediction = predictOn(sb, run.r.env);
    return { row, run, prediction };
  });
  const failures = [];
  for (const { row, run, prediction } of outcomes) {
    const said = `${row.id}: ${row.about}`;
    const exit = run.r.code === 0 ? 0 : 1;
    if (exit !== row.expect.exit) failures.push(`${said}: exit ${run.r.code}, the table says ${row.expect.exit} (${run.r.err.trim().split("\n")[0]})`);
    if (JSON.stringify(run.tools) !== JSON.stringify(row.expect.tools)) failures.push(`${said}: the first request lists ${JSON.stringify(run.tools)}, the table says ${JSON.stringify(row.expect.tools)}`);
    // the prediction, on the same machine, agrees with the binary
    if (JSON.stringify(expectedTools(prediction)) !== JSON.stringify(run.tools)) failures.push(`${said}: predictShell says ${JSON.stringify(expectedTools(prediction))}, the binary listed ${JSON.stringify(run.tools)}`);
    if ((prediction.fatal ? 1 : 0) !== exit) failures.push(`${said}: predictShell says exit ${prediction.fatal ? 1 : 0}, the binary exited ${run.r.code}`);
    // which bash.exe, and why a variable was ignored (the debug log of the binary)
    if (run.r.code === 0) {
      if (prediction.gitBash.path) {
        if (!run.debug.using || !W.same(run.debug.using, prediction.gitBash.path)) failures.push(`${said}: the binary took ${run.debug.using}, the prediction says ${prediction.gitBash.path}`);
      } else if (run.debug.using) failures.push(`${said}: the binary took ${run.debug.using}, the prediction found no Git Bash`);
      const step = prediction.gitBash.trail.find((s) => s.step === "variable");
      if (step && (step.state === "not-found" || step.state === "not-bash")) {
        const want = step.state === "not-found" ? "not found; falling back to auto-detection" : "is not a bash/sh binary; falling back to auto-detection";
        if (!run.debug.warning || !run.debug.warning.endsWith(want)) failures.push(`${said}: the debug log says ${JSON.stringify(run.debug.warning)}, the prediction says the value ${step.state}`);
      } else if (step && step.state !== "valid" && run.debug.warning) failures.push(`${said}: the binary warned about a variable that is ${step.state}: ${run.debug.warning}`);
    }
  }
  t.diagnostic(`${rows.length} of ${ROWS.length} rows run on Claude Code ${claudeInfo().number}${HAS_DEFAULT_GIT ? " (Git at C:\\Program Files\\Git)" : " (no Git at C:\\Program Files\\Git)"}`);
  assert.deepEqual(failures, []);
});

test("the PowerShell tool's edition: the binary and findPowerShell agree for a pwsh on PATH, in ProgramW6432's PowerShell\\7, in .dotnet\\tools, and for Windows PowerShell", { skip: skipUnlessWindows(), timeout: 600000 }, async (t) => {
  const failures = [];
  for (const e of EDITIONS) {
    const row = { ...e, layouts: [], projectFiles: [], settings: {}, env: { ...(e.env || {}), CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, path: e.path || [] };
    const { sb, env } = build({ ...row, files: e.files }, `ed-${e.id}`.slice(0, 18));
    const run = await probeRun(sb, { env });
    const edition = editionOf(run.request);
    const prediction = predictOn(sb, run.r.env);
    if (edition !== prediction.powershell.edition) failures.push(`${e.id}: the tool says ${edition}, findPowerShell says ${prediction.powershell.edition}`);
    const wants = HAS_DEFAULT_PWSH && !e.core && !(e.env && e.env.ProgramW6432) ? "PowerShell 7+ (pwsh)" : e.edition;
    if (e.id === "default" || e.id === "powershell-on-path") { if (edition !== wants) failures.push(`${e.id}: the tool says ${edition}, expected ${wants}`); } else if (edition !== e.edition) failures.push(`${e.id}: the tool says ${edition}, expected ${e.edition}`);
  }
  t.diagnostic(`${EDITIONS.length} editions on Claude Code ${claudeInfo().number}${HAS_DEFAULT_PWSH ? " (PowerShell 7 at ProgramW6432)" : ""}`);
  assert.deepEqual(failures, []);
});

test("defaultShell changes nothing in the request: the same tools, the same system prompt, the same size, with each value it can have, in each state", { skip: skipUnlessWindows(), timeout: 900000 }, async (t) => {
  const plain = (r) => JSON.stringify(r).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?Z?/g, "<time>").replace(/cwd-e2e-dsh-[A-Za-z0-9]{6}/g, "<tmp>").replace(/\\\\/g, "/");
  const states = {
    "Git Bash only": { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/bin/bash.exe" }, applies: true },
    "both tools": { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/bin/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, applies: true },
    "PowerShell only": { layouts: [], env: {}, applies: !HAS_DEFAULT_GIT },
  };
  let compared = 0;
  for (const [name, state] of Object.entries(states)) {
    if (!state.applies) continue;
    const base = build({ layouts: state.layouts, env: state.env, settings: {} }, "dsh");
    const without = await probeRun(base.sb, { env: base.env });
    for (const value of ["bash", "powershell", "cmd"]) {
      const withSetting = build({ layouts: state.layouts, env: state.env, settings: { user: { defaultShell: value } } }, "dsh");
      const run = await probeRun(withSetting.sb, { env: withSetting.env });
      assert.deepEqual(shellTools(run.request), shellTools(without.request), `${name}, defaultShell ${value}: the shell tools`);
      assert.equal(JSON.stringify(run.request.tools.map((x) => x.name)), JSON.stringify(without.request.tools.map((x) => x.name)), `${name}, ${value}: the tool list`);
      assert.equal(plain(run.request).length, plain(without.request).length, `${name}, defaultShell ${value}: the request has the same size`);
      compared++;
    }
  }
  t.diagnostic(`${compared} runs with defaultShell compared with the same state without it, on Claude Code ${claudeInfo().number}`);
  assert.ok(compared >= 6);
});

test("the Git of this machine, as PATH can put it: the binary and predictShell agree for ...\\Git\\cmd first and for ...\\Git\\mingw64\\bin first", { skip: skipUnlessWindows(), timeout: 600000 }, async (t) => {
  // the root of the Git for Windows that this machine has: from the git.exe files that where.exe lists
  const lines = makeSys().where("git", { cwd: process.cwd() }) || [];
  const roots = new Set();
  for (const l of lines) {
    const m = /^(.*)\\(?:cmd|mingw64\\bin|bin|usr\\bin)\\git\.exe$/i.exec(l);
    if (m && fs.existsSync(path.join(m[1], "bin", "bash.exe"))) roots.add(m[1]);
  }
  const realRoot = [...roots][0];
  if (!realRoot) { t.diagnostic("no Git for Windows found through where.exe: skipped"); return; }
  const cases = [
    { id: "cmd-first", dirs: [path.join(realRoot, "cmd")], found: true },
    { id: "mingw-first", dirs: [path.join(realRoot, "mingw64", "bin"), path.join(realRoot, "cmd")], found: HAS_DEFAULT_GIT },
    { id: "mingw-only", dirs: [path.join(realRoot, "mingw64", "bin")], found: HAS_DEFAULT_GIT },
  ];
  for (const c of cases) {
    const sb = sandbox(`real-${c.id}`.slice(0, 18));
    const env = { Path: [...c.dirs, SYSTEM_PATH].join(";") };
    const run = await probeRun(sb, { env });
    const prediction = predictOn(sb, run.r.env);
    assert.deepEqual(run.tools, expectedTools(prediction), `${c.id}: the binary and the prediction`);
    assert.equal(run.tools.includes("Bash"), c.found, `${c.id}: Git Bash at ${realRoot} is ${c.found ? "" : "not "}found`);
  }
  t.diagnostic(`Git for Windows at ${realRoot}${HAS_DEFAULT_GIT ? " (the default place: found through the fixed path whatever PATH says)" : " (not the default place: found only when git.exe is the first line of where git and sits in a folder one below the root)"}`);
});

test("the binary says why: a variable it ignores is named in the debug log with its reason, and a missing Git Bash is named", { skip: skipUnlessWindows(), timeout: 300000 }, async () => {
  const none = build({ layouts: [], env: {}, settings: {} }, "dbg-none");
  const a = await probeRun(none.sb, { env: none.env });
  if (!HAS_DEFAULT_GIT) { assert.equal(a.debug.notFound, true); assert.equal(a.debug.using, null); } else assert.ok(a.debug.using);
  const bad = build({ layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/git-bash.exe" }, settings: {} }, "dbg-bad");
  const b = await probeRun(bad.sb, { env: bad.env });
  assert.match(b.debug.warning, /is not a bash\/sh binary; falling back to auto-detection$/);
  const missing = build({ layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" }, settings: {} }, "dbg-missing");
  const c = await probeRun(missing.sb, { env: missing.env });
  assert.match(c.debug.warning, /not found; falling back to auto-detection$/);
  // the value is checked as written: the check of the tool says the same thing for the same value
  assert.equal(checkBashValue(path.join(bad.sb.root, "layouts", "g1", "git-bash.exe"), makeSys()).state, "not-bash");
});

test("the fake Git trees: where.exe, run by the binary, prints what the pretend machine says it prints", { skip: skipUnlessWindows(), timeout: 120000 }, () => {
  // a row's PATH, read through the real sys: the lines of `where git` are the git.exe files in the order of PATH
  const row = ROWS.find((r) => r.id === "path-order-mingw-first");
  const { sb, env: rowEnv } = build(row, "where-order");
  const env = { ...process.env };
  for (const [k, v] of Object.entries(rowEnv)) setVar(env, k, v);
  const sys = makeSys({ env, cwd: sb.work, home: sb.home });
  const lines = sys.where("git", { cwd: sb.work, env });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /g2\\mingw64\\bin\\git\.exe$/);
  assert.match(lines[1], /g1\\cmd\\git\.exe$/);
  assert.equal(setVar({}, "PATH", "x").PATH, "x");
  const w = fill("{g1}/cmd", { root: "C:/t", work: "C:/w" });
  assert.equal(w, "C:/t/g1/cmd");
});
