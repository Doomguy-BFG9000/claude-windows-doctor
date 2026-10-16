// The real Windows: the registry, wsl.exe, PowerShell, chcp, git, where.exe and the claude binary (when E2E_CLAUDE names one), read only, cross-checked against another way of asking
// where there is one. The registry is never written: fix and undo run against a file that stands in for HKCU\Environment, and the real value is read before and after to show it. These run on
// the Windows jobs of `npm test` and skip on the other systems.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IS_WIN, runCli, tmpDir, world } from "./helpers.mjs";
import { CLAUDE, claudeInfo } from "./claude-sandbox.mjs";
import { makeSys } from "../src/sys.mjs";
import { readRegValue, regUserEnv } from "../src/winenv.mjs";
import { codePageFacts, executionPolicyFacts, gitFacts, longPathFacts, nodeFacts } from "../src/facts.mjs";
import { decodeWsl, parseDistros, windowsWslFacts } from "../src/wsl.mjs";
import { discoverGitBash } from "../src/gitbash.mjs";
import { findClaudes, versionOf } from "../src/binaries.mjs";
import { compareUserEnv } from "../src/userenv.mjs";

const skip = !IS_WIN && "this reads the real Windows";
// no PSModulePath: a Windows PowerShell started from PowerShell 7 (as on a CI runner) would otherwise load the modules of 7 and fail
const psEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
const ps = (command) => spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, input: "", env: psEnv }).stdout.trim();

test("the user environment: the real HKCU\\Environment is listed through reg.exe, read value by value the same, and has the names that every Windows user has", { skip }, () => {
  const sys = makeSys();
  const env = regUserEnv(sys);
  const all = env.list();
  assert.equal(all.ok, true, all.error);
  const names = all.values.map((v) => v.name.toLowerCase());
  assert.ok(names.includes("temp") && names.includes("tmp"), `TEMP and TMP are in ${names.join(", ")}`);
  for (const v of all.values.slice(0, 6)) {
    const one = env.read(v.name);
    assert.deepEqual([one.exists, one.type, one.value], [true, v.type, v.value], v.name);
  }
  assert.equal(env.read("CLAUDE_WINDOWS_DOCTOR_NO_SUCH_VALUE").exists, false);
  // the same names, asked of .NET (a second way)
  const dotnet = ps("[Environment]::GetEnvironmentVariables('User').Keys -join ';'").split(";").map((s) => s.toLowerCase()).sort();
  assert.deepEqual(names.sort(), dotnet, "the same names as .NET gives");
  const cmp = compareUserEnv(sys, env);
  assert.equal(cmp.ok, true);
});

test("a registry value through reg.exe and through PowerShell: the long path switch, and a value with a code page character", { skip }, () => {
  const lp = longPathFacts(makeSys());
  assert.equal(lp.ok, true);
  const viaPs = ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -ErrorAction SilentlyContinue).LongPathsEnabled");
  assert.equal(lp.enabled, viaPs === "1", `LongPathsEnabled is ${viaPs || "not set"} for PowerShell`);
  const cp = readRegValue(makeSys(), "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage", "ACP");
  assert.equal(cp.value, ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage').ACP"));
});

test("PowerShell's execution policy, the console's code page, git's configuration, Node and npm, read for real", { skip, timeout: 120000 }, () => {
  const sys = makeSys();
  const p = executionPolicyFacts(sys);
  assert.equal(p.ok, true, p.error);
  assert.deepEqual(p.list.map((x) => x.scope), ["MachinePolicy", "UserPolicy", "Process", "CurrentUser", "LocalMachine"]);
  assert.equal(p.list.find((x) => x.scope === "CurrentUser").policy, ps("Get-ExecutionPolicy -Scope CurrentUser"));
  const c = codePageFacts(sys);
  assert.equal(c.ok, true, c.error);
  assert.ok(Number.isInteger(c.active) && c.active > 0);
  assert.equal(c.ansi, Number(ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage').ACP")));
  const g = gitFacts(sys, process.cwd());
  assert.equal(g.ok, true, g.error);
  assert.match(g.version, /^\d+\.\d+/);
  const realAutocrlf = spawnSync("git", ["config", "--get", "core.autocrlf"], { encoding: "utf8", windowsHide: true }).stdout.trim();
  assert.equal(g.autocrlf ? g.autocrlf.value : "", realAutocrlf);
  const n = nodeFacts(sys);
  assert.equal(n.node, process.versions.node);
  assert.match(n.npm || "", /^\d+\.\d+\.\d+/);
});

test("WSL through wsl.exe: the UTF-16 output is decoded, and the names are those that wsl -l -q gives", { skip, timeout: 120000 }, () => {
  const sys = makeSys();
  const facts = windowsWslFacts(sys);
  const q = spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe"), ["-l", "-q"], { windowsHide: true, input: "", timeout: 30000 });
  if (q.error || q.status !== 0) { assert.equal(facts.available, false, "no WSL, or none installed"); return; }
  const names = decodeWsl(q.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(facts.distros.map((d) => d.name).sort(), names);
  assert.ok(facts.distros.every((d) => [1, 2].includes(d.version) && d.state));
  assert.ok(facts.distros.filter((d) => d.isDefault).length <= 1);
  const raw = sys.run("wsl.exe", ["-l", "-v"], { binary: true, timeout: 30000 });
  assert.ok(raw.stdout.includes(0), "wsl.exe printed UTF-16: there are NUL bytes between the letters");
  assert.deepEqual(parseDistros(decodeWsl(raw.stdout)).map((d) => d.name).sort(), names);
});

test("Git Bash on this machine: every file that discoverGitBash names exists and starts", { skip, timeout: 120000 }, () => {
  const sys = makeSys();
  const found = discoverGitBash(sys, { cwd: process.cwd() });
  if (!found.length) return;
  for (const f of found) {
    assert.ok(fs.existsSync(f.path), f.path);
    const r = spawnSync(f.path, ["-c", "echo ok"], { encoding: "utf8", windowsHide: true, input: "", timeout: 30000 });
    assert.equal(r.stdout.trim(), "ok", f.path);
  }
});

test("the claude of the oracle is found on PATH, runs first, and its version is the one that --version prints", { skip: skip || (!CLAUDE && "E2E_CLAUDE is not set"), timeout: 120000 }, () => {
  const dir = tmpDir("cwd-find-");
  const exe = path.isAbsolute(CLAUDE) ? CLAUDE : null;
  if (!exe) return;
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path");
  env[key] = `${path.dirname(exe)};${env[key]}`;
  const sys = makeSys({ env });
  const r = findClaudes(sys, { dir });
  assert.equal(r.first.path.toLowerCase(), path.win32.normalize(exe).toLowerCase());
  assert.equal(r.first.version, claudeInfo().number);
  assert.equal(versionOf(sys, exe, dir), claudeInfo().number);
  assert.equal(r.first.runsFirst, true);
  assert.ok(r.entries.every((e) => !e.skipped || e.origin !== "desktop-bundle"), "the desktop app's bundles are real claude.exe files and are run");
});

test("fix and undo through the real command line on Windows: the file that stands in for the registry changes, the record is written in the config folder, and the real registry does not", { skip, timeout: 180000 }, () => {
  const w = world("fixreal");
  const sysReal = makeSys();
  const before = readRegValue(sysReal, "HKCU\\Environment", "CLAUDE_CODE_GIT_BASH_PATH");
  const bash = path.join(tmpDir("cwd-git-"), "Git", "bin", "bash.exe");
  fs.mkdirSync(path.dirname(bash), { recursive: true });
  fs.writeFileSync(bash, "");
  const dry = runCli(["fix", "--git-bash", "--path", bash, "--dry-run", "--json"], { cwd: w.work, env: w.env });
  assert.equal(dry.code, 0, dry.all);
  assert.equal(JSON.parse(dry.out).action, "set");
  assert.deepEqual(w.userEnv(), {});
  assert.ok(!w.exists(w.recordFile));
  const done = runCli(["fix", "--git-bash", "--path", bash, "--json"], { cwd: w.work, env: w.env });
  assert.equal(done.code, 0, done.all);
  const j = JSON.parse(done.out);
  assert.deepEqual([j.layer, j.value, j.key], ["file", bash, w.userEnvFile]);
  assert.deepEqual(w.userEnv(), { CLAUDE_CODE_GIT_BASH_PATH: { type: "REG_SZ", value: bash } });
  const record = w.readJson(w.recordFile);
  assert.deepEqual([record.tool, record.schema, record.name, record.value, record.previous], ["claude-windows-doctor", 1, "CLAUDE_CODE_GIT_BASH_PATH", bash, null]);
  const again = runCli(["fix", "--git-bash", "--path", bash, "--json"], { cwd: w.work, env: w.env });
  assert.equal(JSON.parse(again.out).action, "nothing");
  const undone = runCli(["undo", "--json"], { cwd: w.work, env: w.env });
  assert.equal(undone.code, 0, undone.all);
  assert.deepEqual(w.userEnv(), {});
  assert.ok(!w.exists(w.recordFile));
  assert.equal(JSON.parse(runCli(["undo", "--json"], { cwd: w.work, env: w.env }).out).action, "nothing");
  const after = readRegValue(sysReal, "HKCU\\Environment", "CLAUDE_CODE_GIT_BASH_PATH");
  assert.deepEqual(after, before, "the registry of this machine is as it was");
});

test("check on the real machine, in a throwaway world: it reads, and writes nothing of its own (only the caches of the programs it starts, PowerShell's and npm's, appear, under AppData), and the user environment it compares is the file", { skip, timeout: 180000 }, () => {
  const w = world("checkreal");
  const listing = () => fs.readdirSync(w.base, { recursive: true }).map((p) => String(p).replace(/\//g, "\\")).sort();
  const before = listing();
  const r = runCli(["check", "--json", "--project", w.work], { cwd: w.work, env: w.env });
  assert.ok([0, 1].includes(r.code), r.all);
  const doc = JSON.parse(r.out);
  assert.equal(doc.kind, "windows");
  assert.equal(doc.shell.gitBash.trail[0].step, "variable");
  assert.ok(doc.binaries.entries.every((e) => e.path));
  assert.equal(doc.userEnv.layer, "file");
  const appeared = listing().filter((p) => !before.includes(p));
  const underAppData = (p) => /^home\\AppData(\\|$)/.test(p);
  assert.ok(appeared.every(underAppData), `check wrote nothing of its own: ${appeared.filter((p) => !underAppData(p)).join(", ")}`);
  assert.deepEqual(fs.readdirSync(w.claude), [], "the config folder is as it was");
  assert.ok(!appeared.some((p) => /npm-cache\\_/.test(p)), `npm wrote no log and no update-notifier file: ${appeared.join(", ")}`);
  // markdown: exit 0 and short
  const md = runCli(["check", "--markdown", "--project", w.work], { cwd: w.work, env: w.env });
  assert.equal(md.code, 0);
  assert.ok(md.out.split("\n").length <= 20);
});
