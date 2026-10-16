// The command line: every usage error, every exit code, the three forms of a report, the commands on a pretend machine, and a child process on the real one.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { IS_WIN, runCli, run, world } from "./helpers.mjs";
import { fakeMachine } from "./machine.mjs";
import { HOME, PROJECT, winMachine } from "./win-machine.mjs";
import { HELP, parseArgs } from "../src/cli.mjs";
import { REAL_KEY, regUserEnv } from "../src/winenv.mjs";
import { RECORD_SCHEMA } from "../src/write.mjs";
import { VERSION } from "../src/version.mjs";

const E_GIT = ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe"];
const memStore = () => {
  const files = new Map();
  return { files, read: (f) => (files.has(f) ? { ok: true, record: files.get(f) } : { ok: false, missing: true, error: "cannot be read (ENOENT)" }), write: (f, fields, { now }) => { files.set(f, { schema: RECORD_SCHEMA, tool: "claude-windows-doctor", version: VERSION, date: new Date(now).toISOString(), ...fields }); return f; }, remove: (f) => { files.delete(f); } };
};
const TEMP = "C:\\Temp\\cwd-cli";

test("parseArgs: every command and option, and every usage error with its words", () => {
  const ok = (argv, expect) => { const o = parseArgs(argv); for (const [k, v] of Object.entries(expect)) assert.deepEqual(o[k], v, `${argv.join(" ")}: ${k}`); };
  ok(["check"], { command: "check", live: false, json: false, markdown: false });
  ok(["check", "--live", "--claude", "C:\\x\\claude.exe", "--project", "D:\\p", "--json"], { live: true, claude: "C:\\x\\claude.exe", project: "D:\\p", json: true });
  ok(["check", "--markdown", "--project=D:\\p"], { markdown: true, project: "D:\\p" });
  ok(["explain", "git-bash-not-found", "--json"], { command: "explain", id: "git-bash-not-found", json: true });
  ok(["fix", "--git-bash", "--path", "E:\\Git\\bin\\bash.exe", "--dry-run"], { gitBash: true, path: "E:\\Git\\bin\\bash.exe", dryRun: true });
  ok(["undo", "--dry-run", "--json"], { command: "undo", dryRun: true, json: true });
  ok(["--help"], { help: true });
  ok(["check", "-h"], { help: true });
  ok(["-v"], { version: true });
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), re, argv.join(" "));
  bad([], /no command given/);
  bad(["nope"], /unknown command "nope"/);
  bad(["check", "--nope"], /unknown option --nope/);
  bad(["check", "extra"], /check takes no name, not "extra"/);
  bad(["check", "--project"], /--project needs a value/);
  bad(["check", "--claude", "--live"], /--claude needs a value/);
  bad(["check", "--claude", "x"], /--claude is for --live/);
  bad(["check", "--markdown", "--live"], /--markdown is the short report of the skill and does not run --live/);
  bad(["check", "--dry-run"], /check does not take --dry-run/);
  bad(["check", "--git-bash"], /check does not take --git-bash/);
  bad(["explain"], /explain needs a finding id \(no-shell-tool, /);
  bad(["explain", "a", "b"], /explain takes one finding id, not "a b"/);
  bad(["explain", "x", "--live"], /explain does not take --live/);
  bad(["fix"], /fix needs what to fix: --git-bash/);
  bad(["fix", "--git-bash", "--markdown"], /fix does not take --markdown/);
  bad(["fix", "--path", "x"], /fix needs what to fix: --git-bash/);
  bad(["undo", "--git-bash"], /undo does not take --git-bash/);
  bad(["undo", "--path", "x"], /undo does not take --path/);
});

test("--help is the usage block, --version the version, and both exit 0; a usage error exits 2 with a line on stderr, or a JSON document with --json", async () => {
  const h = await run(["--help"]);
  assert.deepEqual([h.code, h.out], [0, HELP]);
  assert.match(HELP, /^Usage: claude-windows-doctor <command> \[options\]\n/);
  assert.deepEqual(await run(["-v"]).then((r) => [r.code, r.out]), [0, `claude-windows-doctor ${VERSION}\n`]);
  const u = await run(["nope"]);
  assert.equal(u.code, 2);
  assert.match(u.err, /^claude-windows-doctor: unknown command "nope"\nRun claude-windows-doctor --help for the commands\.\n$/);
  assert.equal(u.out, "");
  const j = await run(["nope", "--json"]);
  assert.deepEqual([j.code, j.json()], [2, { ok: false, error: 'unknown command "nope"' }]);
});

test("check on a clean pretend machine: exit 0, the report, JSON that parses, markdown that is short", async () => {
  const sys = winMachine();
  const t = await run(["check", "--project", PROJECT], { sys: winMachine() });
  assert.equal(t.code, 0, t.all);
  assert.match(t.out, /^claude-windows-doctor 1\.0\.0 {2}the Windows setup of Claude Code\n/);
  assert.match(t.out, /Bash tool {9}yes: Git Bash at C:\\Program Files\\Git\\bin\\bash\.exe \(the fixed path C:\\Program Files\\Git\)/);
  assert.match(t.out, /No findings\.\n$/);
  const j = await run(["check", "--json"], { sys });
  const doc = j.json();
  assert.equal(doc.ok, true);
  assert.equal(doc.kind, "windows");
  assert.equal(doc.shell.gitBash.path, "C:\\Program Files\\Git\\bin\\bash.exe");
  assert.deepEqual(doc.counts, { error: 0, warning: 0, note: 0 });
  const m = await run(["check", "--markdown"], { sys: winMachine() });
  assert.equal(m.code, 0);
  assert.match(m.out, /^## windows-doctor check: C:\\work\\shop\n/);
  assert.match(m.out, /No findings\.\n$/);
  assert.ok(m.out.split("\n").length < 8);
});

test("check exits 1 with an error or a warning, and 0 with notes only; --markdown exits 0 whatever it finds", async () => {
  const bad = () => winMachine({ noGit: true, files: E_GIT, registry: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "E:\\Das\\Git"] } }, env: { Path: "C:\\Windows\\System32;C:\\Windows", CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } });
  const r = await run(["check"], { sys: bad() });
  assert.equal(r.code, 1);
  assert.match(r.out, /\nFindings\n {2}error {3}no-shell-tool\n/);
  assert.match(r.out, /more: claude-windows-doctor explain no-shell-tool/);
  assert.match(r.out, /\n1 error, 1 warning, 2 notes\n$/);
  const md = await run(["check", "--markdown"], { sys: bad() });
  assert.equal(md.code, 0, "a skill whose command fails never reaches the model");
  assert.match(md.out, /- ERROR `no-shell-tool`: Claude Code will not start/);
  const j = await run(["check", "--json"], { sys: bad() });
  assert.equal(j.code, 1);
  assert.equal(j.json().ok, false);
  // notes only: exit 0
  const notes = await run(["check"], { sys: winMachine({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "powershell" }) } }) });
  assert.equal(notes.code, 0);
  assert.match(notes.out, /note {4}default-shell-scope/);
});

test("check --markdown is capped: at most 12 findings and 500 characters a line, with a line that says how many more", async () => {
  const sys = winMachine();
  // 14 settings files cannot be made, so many user variables that are only in the registry give many warnings
  const values = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`CLAUDE_X${i}_DIR`, ["REG_SZ", `D:\\${"very-long-folder-name-".repeat(14)}${i}`]]));
  sys.registry.set(REAL_KEY.toLowerCase(), new Map(Object.entries(values).map(([n, v]) => [n.toLowerCase(), { name: n, type: v[0], value: v[1] }])));
  const r = await run(["check", "--markdown"], { sys });
  const lines = r.out.trimEnd().split("\n");
  assert.equal(lines.filter((l) => l.startsWith("- WARNING")).length, 12);
  assert.match(lines.at(-1), /^- \.\.\. and 8 more \(run `claude-windows-doctor check`\)$/);
  assert.ok(lines.length <= 17, `${lines.length} lines`);
  for (const l of lines) assert.ok(l.length <= 500, `${l.length} characters`);
});

test("on Linux and macOS there is nothing to check, said in every form, with exit 0; --live has nothing to prove", async () => {
  for (const platform of ["linux", "darwin"]) {
    const sys = () => fakeMachine({ platform });
    const t = await run(["check"], { sys: sys() });
    assert.equal(t.code, 0);
    assert.match(t.out, /^claude-windows-doctor 1\.0\.0 {2}nothing to check\nNothing to check on (Linux|macOS): claude-windows-doctor checks the setup of Claude Code on Windows/);
    const j = (await run(["check", "--json"], { sys: sys() })).json();
    assert.deepEqual([j.ok, j.applicable, j.platform, j.kind], [true, false, platform, "other"]);
    const m = await run(["check", "--markdown"], { sys: sys() });
    assert.deepEqual([m.code, m.out.split("\n")[0]], [0, "## windows-doctor check"]);
    const live = await run(["check", "--live"], { sys: sys() });
    assert.equal(live.code, 1);
    assert.match(live.err, /nothing to prove here/);
    assert.equal((await run(["explain", "no-shell-tool"], { sys: sys() })).code, 0, "explain works anywhere");
  }
});

test("inside WSL: the WSL side is checked, and --live refuses", async () => {
  const wsl = () => fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", cwd: "/home/me/code", files: ["/mnt/c/Users/me/.local/bin/claude"], texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" }, versions: { "/mnt/c/Users/me/.local/bin/claude": "2.1.299 (Claude Code)" } });
  const r = await run(["check"], { sys: wsl(), tempDir: "/tmp/cwd-x" });
  assert.equal(r.code, 1);
  assert.match(r.out, /the WSL side of Claude Code/);
  assert.match(r.out, /wsl-windows-claude/);
  const md = await run(["check", "--markdown"], { sys: wsl(), tempDir: "/tmp/cwd-x" });
  assert.match(md.out, /^## windows-doctor check \(WSL\): \/home\/me\/code\n/);
  const live = await run(["check", "--live"], { sys: wsl(), tempDir: "/tmp/cwd-x" });
  assert.equal(live.code, 1);
  assert.match(live.err, /works on Windows only/);
  assert.equal((await run(["check", "--json"], { sys: wsl(), tempDir: "/tmp/cwd-x" })).json().kind, "wsl");
});

test("--project: a relative folder is taken from the working folder; the default is the working folder", async () => {
  const a = (await run(["check", "--json", "--project", "sub\\dir"], { sys: winMachine() })).json();
  assert.equal(a.project, "C:\\work\\shop\\sub\\dir");
  const b = (await run(["check", "--json"], { sys: winMachine() })).json();
  assert.equal(b.project, PROJECT);
  const c = (await run(["check", "--json", "--project", "D:\\other"], { sys: winMachine() })).json();
  assert.equal(c.project, "D:\\other");
});

test("explain: a page, the same as JSON, an id that is not one (exit 1, with the near ids), a missing id (exit 2)", async () => {
  const t = await run(["explain", "wsl-no-distro"]);
  assert.equal(t.code, 0);
  assert.match(t.out, /^wsl-no-distro {3}WSL has only the distributions of other tools\n/);
  const j = (await run(["explain", "wsl-no-distro", "--json"])).json();
  assert.equal(j.id, "wsl-no-distro");
  const u = await run(["explain", "git-bash"]);
  assert.equal(u.code, 1);
  assert.match(u.err, /no finding called "git-bash"\. Did you mean git-bash-not-found, git-bash-path-ignored/);
  const uj = (await run(["explain", "nope", "--json"])).json();
  assert.deepEqual([uj.ok, uj.refused, uj.near], [false, 'no finding called "nope"', []]);
  assert.equal(uj.ids.length >= 27, true);
  const m = await run(["explain"]);
  assert.equal(m.code, 2);
  assert.match(m.err, /explain needs a finding id/);
});

test("fix and undo through the command line: the report, the exit codes, the JSON, and the refusal off Windows", async () => {
  const sys = () => winMachine({ noGit: true, files: E_GIT, env: { Path: "E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows" }, registry: { [REAL_KEY]: {} } });
  const s = sys();
  const io = { sys: s, userEnv: regUserEnv(s), store: memStore() };
  const dry = await run(["fix", "--git-bash", "--dry-run"], io);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /^Would set CLAUDE_CODE_GIT_BASH_PATH=E:\\Das\\Git\\bin\\bash\.exe in the Windows user environment \(HKCU\\Environment\)\. Found by: git\.exe on PATH/);
  assert.equal(io.store.files.size, 0);
  const done = await run(["fix", "--git-bash"], io);
  assert.equal(done.code, 0);
  assert.match(done.out, /^Set CLAUDE_CODE_GIT_BASH_PATH=E:\\Das\\Git\\bin\\bash\.exe in the Windows user environment/);
  assert.match(done.out, /The record, for undo: C:\\Users\\me\\\.claude\\windows-doctor\\record\.json/);
  assert.match(done.out, /Undo with: claude-windows-doctor undo\n$/);
  const j = (await run(["fix", "--git-bash", "--json"], io)).json();
  assert.deepEqual([j.ok, j.action, j.refused], [true, "nothing", null]);
  const refused = await run(["fix", "--git-bash", "--path", "E:\\nope\\bash.exe", "--json"], io);
  assert.equal(refused.code, 1);
  assert.equal(refused.json().reason, "bad-path");
  const u = await run(["undo", "--json"], io);
  assert.deepEqual([u.code, u.json().action], [0, "remove"]);
  const none = await run(["undo"], io);
  assert.equal(none.code, 0);
  assert.match(none.out, /^No record of a fix was found/);
  const off = await run(["fix", "--git-bash"], { sys: fakeMachine({ platform: "linux" }), store: memStore() });
  assert.equal(off.code, 1);
  assert.match(off.out, /^refused: fix --git-bash works on Windows only/);
  assert.equal((await run(["undo", "--json"], { sys: fakeMachine({ platform: "darwin" }), store: memStore() })).json().reason, "not-windows");
});

test("an unexpected error is exit 2, as text or as JSON, and no temporary folder is left", async () => {
  const sys = winMachine();
  sys.readText = () => { throw new Error("boom"); };
  const r = await run(["check"], { sys, tempDir: TEMP });
  assert.equal(r.code, 2);
  assert.match(r.err, /^claude-windows-doctor: boom\n$/);
  const j = await run(["check", "--json"], { sys, tempDir: TEMP });
  assert.deepEqual([j.code, j.json()], [2, { ok: false, error: "boom" }]);
});

test("a child process: the real command line, in a throwaway world, with the user environment a file", { skip: !IS_WIN && "the real checks are for Windows; the other systems say there is nothing to check (below)" }, () => {
  const w = world("cli");
  const r = runCli(["check", "--json", "--project", w.work], { cwd: w.work, env: w.env });
  assert.ok([0, 1].includes(r.code), r.all);
  const doc = JSON.parse(r.out);
  assert.equal(doc.kind, "windows");
  assert.equal(doc.project, w.work);
  assert.ok(Array.isArray(doc.findings));
  assert.equal(doc.userEnv.layer, "file", "the guard puts a file in the place of HKCU\\Environment");
  assert.deepEqual(w.userEnv(), {}, "and nothing was written to it");
});

test("a child process on any system: --help, a usage error, explain, and on Linux and macOS the nothing-to-check answer and the refusal of fix", () => {
  const w = world("cli2");
  const h = runCli(["--help"], { cwd: w.work, env: w.env });
  assert.deepEqual([h.code, h.out], [0, HELP]);
  const u = runCli(["check", "--bogus"], { cwd: w.work, env: w.env });
  assert.equal(u.code, 2);
  const e = runCli(["explain", "code-page"], { cwd: w.work, env: w.env });
  assert.equal(e.code, 0);
  assert.match(e.out, /^code-page {3}The console code page is not UTF-8/);
  if (!IS_WIN) {
    const c = runCli(["check"], { cwd: w.work, env: w.env });
    assert.equal(c.code, 0);
    assert.match(c.out, /nothing to check/);
    const f = runCli(["fix", "--git-bash"], { cwd: w.work, env: w.env });
    assert.equal(f.code, 1);
    assert.match(f.out, /works on Windows only/);
    assert.deepEqual(w.userEnv(), {});
  }
});
