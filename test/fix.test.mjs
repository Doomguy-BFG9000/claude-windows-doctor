// fix --git-bash and undo, against a pretend registry (the reg.exe command lines are the ones that would be run) and an in-memory store for the
// record: the plan, the dry run, the record, idempotence, what is refused, and that nothing but the one value is ever touched.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { HOME, PROJECT, winMachine } from "./win-machine.mjs";
import { recordPlaces, runFix, runUndo } from "../src/fix.mjs";
import { REAL_KEY, regUserEnv } from "../src/winenv.mjs";
import { RECORD_SCHEMA } from "../src/write.mjs";
import { VERSION } from "../src/version.mjs";

const NAME = "CLAUDE_CODE_GIT_BASH_PATH";
const E_GIT = ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe", "E:\\Das\\Git\\usr\\bin\\bash.exe"];
const MINGW_PATH = "E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows";
const RECORD = `${HOME}\\.claude\\windows-doctor\\record.json`;

/** A machine where Claude Code does not find Git Bash (mingw64\bin first), with Git at E:\Das\Git, and the layers for the registry and the record. */
function world(o = {}) {
  const sys = winMachine({ noGit: true, files: E_GIT, env: { Path: MINGW_PATH, ...(o.env || {}) }, registry: { [REAL_KEY]: o.user || {}, ...(o.registry || {}) }, texts: o.texts, commands: o.commands });
  const files = new Map(o.records || []);
  const store = {
    files,
    read: (f) => (files.has(f) ? { ok: true, record: files.get(f) } : { ok: false, missing: true, error: "cannot be read (ENOENT)" }),
    write: (f, fields, { now } = {}) => { files.set(f, { schema: RECORD_SCHEMA, tool: "claude-windows-doctor", version: VERSION, date: new Date(now).toISOString(), ...fields }); return f; },
    remove: (f) => { files.delete(f); },
  };
  return { sys, store, userEnv: regUserEnv(sys), files, reg: () => regUserEnv(sys).list().values.filter((v) => v.name !== "CLAUDE_WINDOWS_DOCTOR_NOTIFY") };
}
const NOW = Date.parse("2026-10-16T12:00:00Z");
const fix = (w, o = {}) => runFix(w.sys, { userEnv: w.userEnv, store: w.store, project: PROJECT, now: NOW, ...o });
const undo = (w, o = {}) => runUndo(w.sys, { userEnv: w.userEnv, store: w.store, ...o });

test("fix then undo: the value is set with a record, a second fix does nothing, undo takes it away and deletes the record, a second undo does nothing", () => {
  const w = world();
  const dry = fix(w, { dryRun: true });
  assert.deepEqual([dry.ok, dry.action, dry.dryRun, dry.value, dry.previous], [true, "set", true, "E:\\Das\\Git\\bin\\bash.exe", null]);
  assert.match(dry.via, /^git\.exe on PATH \(E:\\Das\\Git\\mingw64\\bin\\git\.exe\)$/);
  assert.match(dry.notes.join(" "), /Nothing was changed \(--dry-run\)/);
  assert.deepEqual(w.reg(), [], "a dry run changes nothing");
  assert.equal(w.files.size, 0);

  const r = fix(w);
  assert.deepEqual([r.ok, r.action, r.name, r.key, r.layer, r.value], [true, "set", NAME, "HKCU\\Environment", "registry", "E:\\Das\\Git\\bin\\bash.exe"]);
  assert.deepEqual(w.reg(), [{ name: NAME, type: "REG_SZ", value: "E:\\Das\\Git\\bin\\bash.exe" }]);
  assert.deepEqual(w.files.get(RECORD), { schema: 1, tool: "claude-windows-doctor", version: VERSION, date: "2026-10-16T12:00:00.000Z", action: "git-bash", platform: "win32", key: "HKCU\\Environment", layer: "registry", name: NAME, value: "E:\\Das\\Git\\bin\\bash.exe", previous: null, previousType: null, via: r.via });
  assert.equal(r.record, RECORD);
  assert.match(r.notes.join(" "), /open a new terminal, and restart the desktop app or the editor/);

  const again = fix(w);
  assert.deepEqual([again.ok, again.action], [true, "nothing"]);
  assert.match(again.notes[0], /already E:\\Das\\Git\\bin\\bash\.exe in the user environment/);

  const dryUndo = undo(w, { dryRun: true });
  assert.deepEqual([dryUndo.ok, dryUndo.action], [true, "remove"]);
  assert.equal(w.reg().length, 1);
  assert.ok(w.files.has(RECORD));

  const u = undo(w);
  assert.deepEqual([u.ok, u.action], [true, "remove"]);
  assert.deepEqual(w.reg(), []);
  assert.equal(w.files.size, 0, "the record is deleted");
  const twice = undo(w);
  assert.deepEqual([twice.ok, twice.action], [true, "nothing"]);
  assert.match(twice.notes[0], /No record of a fix was found/);
});

test("an old value is kept in the record with its type, and undo puts both back", () => {
  const w = world({ user: { [NAME]: ["REG_EXPAND_SZ", "%USERPROFILE%\\old\\bash.exe"], KEEP: ["REG_SZ", "kept"] } });
  const r = fix(w);
  assert.deepEqual(r.previous, { value: "%USERPROFILE%\\old\\bash.exe", type: "REG_EXPAND_SZ" });
  assert.equal(w.files.get(RECORD).previous, "%USERPROFILE%\\old\\bash.exe");
  assert.equal(w.files.get(RECORD).previousType, "REG_EXPAND_SZ");
  assert.equal(regUserEnv(w.sys).read(NAME).value, "E:\\Das\\Git\\bin\\bash.exe");
  const u = undo(w);
  assert.equal(u.action, "restore");
  assert.deepEqual(regUserEnv(w.sys).read(NAME), { ok: true, exists: true, type: "REG_EXPAND_SZ", value: "%USERPROFILE%\\old\\bash.exe", error: null });
  assert.equal(regUserEnv(w.sys).read("KEEP").value, "kept", "no other value was touched");
  assert.equal(w.files.size, 0);
});

test("only reg add and reg delete of this one value, and the broadcast, are ever run; nothing is set through setx", () => {
  const w = world({ user: { KEEP: ["REG_SZ", "kept"] } });
  fix(w);
  undo(w);
  const writes = w.sys.runs.filter((r) => /reg(\.exe)?$/i.test(r.cmd) && (r.args[0] === "add" || r.args[0] === "delete"));
  assert.deepEqual(writes.map((r) => [r.args[0], r.args[3]]),[["add", NAME], ["delete", "CLAUDE_WINDOWS_DOCTOR_NOTIFY"], ["delete", NAME], ["delete", "CLAUDE_WINDOWS_DOCTOR_NOTIFY"]]);
  const setx = w.sys.runs.filter((r) => /setx/i.test(r.cmd));
  assert.ok(setx.every((r) => r.args[0] === "CLAUDE_WINDOWS_DOCTOR_NOTIFY"), "setx only sends the notice");
  assert.equal(regUserEnv(w.sys).read("KEEP").value, "kept");
});

test("nothing to fix when Claude Code finds Git Bash itself; --path pins it anyway", () => {
  const w = world({ env: { Path: "E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows" } });
  const r = fix(w);
  assert.deepEqual([r.ok, r.action, r.value], [true, "nothing", "E:\\Das\\Git\\bin\\bash.exe"]);
  assert.match(r.notes[0], /finds Git Bash by itself, at E:\\Das\\Git\\bin\\bash\.exe \(the first git\.exe on PATH\)/);
  assert.match(r.notes[1], /lists \.\.\.\\Git\\mingw64\\bin before \.\.\.\\Git\\cmd .* pass --path/);
  assert.deepEqual(w.reg(), []);
  const pinned = fix(w, { bashPath: "E:\\Das\\Git\\bin\\bash.exe" });
  assert.deepEqual([pinned.action, pinned.via], ["set", "--path"]);
  assert.equal(w.reg().length, 1);
  const withDefault = winMachine({ registry: { [REAL_KEY]: {} } });
  assert.match(runFix(withDefault, { userEnv: regUserEnv(withDefault), store: world().store, project: PROJECT, now: NOW }).notes[0], /the fixed path C:\\Program Files\\Git/);
});

test("--path: a bash.exe, or a Git for Windows folder; a bad path is refused with the reason, and nothing is written", () => {
  const w = world();
  const folder = fix(w, { bashPath: "E:/Das/Git" });
  assert.equal(folder.value, "E:\\Das\\Git\\bin\\bash.exe");
  undo(w);
  for (const [arg, re] of [["E:\\Das\\Git\\cmd\\git.exe", /is not a bash\.exe/], ["E:\\Nope\\bash.exe", /does not exist/], ["bash.exe", /absolute path/], ["E:\\Das", /no bash\.exe in E:\\Das/]]) {
    const r = fix(w, { bashPath: arg });
    assert.equal(r.ok, false, arg);
    assert.equal(r.reason, "bad-path");
    assert.match(r.refused, re, arg);
  }
  assert.deepEqual(w.reg(), []);
  assert.equal(w.files.size, 0);
});

test("the Git Bash that already works in this process is the one that is set, not another; with several Git Bash files the first is used and the others are named", () => {
  const w = world({ env: { [NAME]: "E:\\Das\\Git\\bin\\bash.exe" } });
  const r = fix(w);
  assert.match(r.via, /the process environment \(it works there, and not in other programs\)/);
  assert.equal(r.value, "E:\\Das\\Git\\bin\\bash.exe");
  const two = world();
  two.sys = winMachine({ noGit: true, files: [...E_GIT, "D:\\Other\\Git\\bin\\bash.exe"], env: { Path: `${MINGW_PATH};D:\\Other\\Git\\cmd` }, registry: { [REAL_KEY]: {} } });
  two.userEnv = regUserEnv(two.sys);
  const t = fix(two, { dryRun: true });
  assert.equal(t.value, "E:\\Das\\Git\\bin\\bash.exe");
});

test("a value in the user settings or the managed settings wins over the user environment: fix does nothing when it works, and refuses when it does not", () => {
  const good = world({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { [NAME]: "E:\\Das\\Git\\bin\\bash.exe" } }) } });
  const r = fix(good);
  assert.deepEqual([r.ok, r.action], [true, "nothing"]);
  assert.match(r.notes[0], /already set to E:\\Das\\Git\\bin\\bash\.exe in the user settings/);
  assert.deepEqual(good.reg(), []);
  const bad = world({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { [NAME]: "E:\\gone\\bash.exe" } }) } });
  const b = fix(bad);
  assert.equal(b.ok, false);
  assert.equal(b.reason, "settings-env");
  assert.match(b.refused, /set in the user settings \(~\\\.claude\\settings\.json\) and is ignored by Claude Code \(there is no such file\); the settings win over the user environment, so fix cannot help/);
  assert.deepEqual(bad.reg(), []);
  // a project file does not count for this variable, so fix is still needed
  const project = world({ texts: { [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ env: { [NAME]: "E:\\Das\\Git\\bin\\bash.exe" } }) } });
  assert.equal(fix(project).action, "set");
});

test("no Git Bash on the machine: refused, and why", () => {
  const sys = winMachine({ noGit: true, registry: { [REAL_KEY]: {} } });
  const r = runFix(sys, { userEnv: regUserEnv(sys), store: world().store, project: PROJECT, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-git-bash");
  assert.match(r.refused, /No Git Bash was found on this machine .* Install Git for Windows, or pass --path <bash\.exe>/);
});

test("a registry that cannot be written, or a record that cannot be written, leaves the user environment as it was", () => {
  const denied = world({ user: { [NAME]: ["REG_SZ", "C:\\old\\bash.exe"] } });
  const base = denied.sys.run;
  denied.sys.run = (cmd, args, opts) => (/reg(\.exe)?$/i.test(cmd) && args[0] === "add" ? { status: 1, stdout: "", stderr: "ERROR: Access is denied.", error: null, timedOut: false } : base(cmd, args, opts));
  const r = fix(denied);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "write-failed");
  assert.match(r.refused, /could not be changed: reg add failed \(ERROR: Access is denied\.\)/);
  assert.equal(denied.files.size, 0);

  const noRecord = world({ user: { [NAME]: ["REG_EXPAND_SZ", "%X%\\old.exe"] } });
  noRecord.store.write = () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); };
  const q = fix(noRecord);
  assert.equal(q.ok, false);
  assert.equal(q.reason, "record-failed");
  assert.match(q.refused, /could not be written \(ENOSPC\), so the user environment was put back as it was/);
  assert.deepEqual(regUserEnv(noRecord.sys).read(NAME), { ok: true, exists: true, type: "REG_EXPAND_SZ", value: "%X%\\old.exe", error: null });
  const fresh = world();
  fresh.store.write = () => { throw new Error("x"); };
  assert.equal(fix(fresh).ok, false);
  assert.deepEqual(fresh.reg(), [], "no value, no record");
});

test("undo: a value that was changed since is left alone and the record deleted; a value that is gone; a record that is not one; no record", () => {
  const w = world();
  fix(w);
  regUserEnv(w.sys).write(NAME, "D:\\someone\\else\\bash.exe");
  const u = undo(w);
  assert.deepEqual([u.ok, u.action], [true, "forget"]);
  assert.match(u.notes[0], /is D:\\someone\\else\\bash\.exe in the user environment now, not the E:\\Das\\Git\\bin\\bash\.exe that fix set: left as it is, and the record deleted/);
  assert.equal(regUserEnv(w.sys).read(NAME).value, "D:\\someone\\else\\bash.exe");
  assert.equal(w.files.size, 0);

  const gone = world();
  fix(gone);
  regUserEnv(gone.sys).remove(NAME);
  const g = undo(gone, { dryRun: true });
  assert.equal(g.action, "forget");
  assert.ok(gone.files.has(RECORD), "a dry run keeps the record");
  assert.match(g.notes[0], /not set in the user environment any more: it would be left as it is, and the record deleted/);
  assert.equal(undo(gone).action, "forget");
  assert.equal(gone.files.size, 0);

  const bad = world({ records: [[RECORD, { tool: "other" }]] });
  bad.store.read = () => ({ ok: false, missing: false, error: "was not written by claude-windows-doctor" });
  const b = undo(bad);
  assert.equal(b.ok, false);
  assert.equal(b.reason, "bad-record");
  assert.match(b.refused, /was not written by claude-windows-doctor/);

  const old = world();
  fix(old);
  const o = undo(old, { dryRun: true });
  assert.match(o.notes[0], /^Would remove CLAUDE_CODE_GIT_BASH_PATH from the user environment, and delete the record/);
});

test("undo finds the record of the config folder in use, and of the default folder", () => {
  const sys = winMachine({ env: { CLAUDE_CONFIG_DIR: "D:\\cfg" }, registry: { [REAL_KEY]: {} } });
  assert.deepEqual(recordPlaces(sys), ["D:\\cfg\\windows-doctor\\record.json", `${HOME}\\.claude\\windows-doctor\\record.json`]);
  assert.deepEqual(recordPlaces(winMachine({ registry: { [REAL_KEY]: {} } })), [RECORD], "one place when they are the same");
});

test("both refuse off Windows, with the same reason, and write nothing", () => {
  for (const platform of ["linux", "darwin"]) {
    const sys = fakeMachine({ platform, registry: { [REAL_KEY]: {} } });
    const layer = regUserEnv(sys);
    const store = world().store;
    const f = runFix(sys, { userEnv: layer, store });
    const u = runUndo(sys, { userEnv: layer, store });
    for (const r of [f, u]) { assert.equal(r.ok, false); assert.equal(r.reason, "not-windows"); assert.match(r.refused, /works on Windows only: it changes a variable of the Windows user environment/); }
    assert.equal(sys.runs.length, 0, "no program was started");
  }
});
