// The only code that writes: the record of fix, the throwaway folders, and nothing else. Real files in a temporary folder.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpDir } from "./helpers.mjs";
import { RECORD_SCHEMA, deleteRecord, makeLiveWorld, makeTempDir, readRecord, recordFileOf, removeTempDir, writeRecord } from "../src/write.mjs";
import { VERSION } from "../src/version.mjs";

const FIELDS = { action: "git-bash", name: "CLAUDE_CODE_GIT_BASH_PATH", key: "HKCU\\Environment", value: "E:\\Das\\Git\\bin\\bash.exe", previous: null, previousType: null };

test("the record: written through a temporary file, read back whole, with the tool, the schema, the version and the date", () => {
  const dir = tmpDir("cwd-rec-");
  const file = recordFileOf(dir);
  assert.ok(file.endsWith(`windows-doctor${path.sep}record.json`) || file.endsWith("windows-doctor\\record.json"));
  const written = writeRecord(path.join(dir, "windows-doctor", "record.json"), FIELDS, { now: Date.parse("2026-10-16T12:00:00Z") });
  const r = readRecord(written);
  assert.equal(r.ok, true);
  assert.deepEqual(r.record, { schema: RECORD_SCHEMA, tool: "claude-windows-doctor", version: VERSION, date: "2026-10-16T12:00:00.000Z", ...FIELDS });
  assert.deepEqual(fs.readdirSync(path.dirname(written)), ["record.json"], "no temporary file is left");
  assert.ok(!fs.readFileSync(written, "utf8").includes("\r"), "LF line endings");
});

test("readRecord says why a file is not a record: missing, not JSON, not an object, not ours, another schema, a field gone", () => {
  const dir = tmpDir("cwd-rec-");
  const f = path.join(dir, "r.json");
  assert.deepEqual(readRecord(f), { ok: false, missing: true, error: "cannot be read (ENOENT)" });
  const bad = (text, re) => { fs.writeFileSync(f, text); const r = readRecord(f); assert.equal(r.ok, false); assert.equal(r.missing, false); assert.match(r.error, re); };
  bad("{", /not valid JSON/);
  bad("[1]", /not a JSON object/);
  bad(JSON.stringify({ tool: "claude-relocate", schema: 1 }), /not written by claude-windows-doctor/);
  bad(JSON.stringify({ tool: "claude-windows-doctor", schema: 2 }), /schema 2/);
  bad(JSON.stringify({ tool: "claude-windows-doctor", schema: 1, name: "X", key: "K" }), /no value/);
  bad(JSON.stringify({ tool: "claude-windows-doctor", schema: 1, name: "X", key: "K", value: "V", previous: 5 }), /previous value that is not text/);
  fs.writeFileSync(f, `﻿${JSON.stringify({ tool: "claude-windows-doctor", schema: 1, name: "X", key: "K", value: "V", previous: null })}`);
  assert.equal(readRecord(f).ok, true, "a byte-order mark is fine");
});

test("deleteRecord removes the record and its folder when that is empty, and leaves a folder that holds something else", () => {
  const dir = tmpDir("cwd-rec-");
  const file = writeRecord(path.join(dir, "windows-doctor", "record.json"), FIELDS);
  deleteRecord(file);
  assert.ok(!fs.existsSync(path.dirname(file)));
  const file2 = writeRecord(path.join(dir, "windows-doctor", "record.json"), FIELDS);
  fs.writeFileSync(path.join(dir, "windows-doctor", "other.txt"), "x");
  deleteRecord(file2);
  assert.ok(fs.existsSync(path.join(dir, "windows-doctor", "other.txt")));
  deleteRecord(file2);
});

test("makeTempDir makes a folder under the temporary folder, and removeTempDir removes only what makeTempDir made", () => {
  const d = makeTempDir(os.tmpdir());
  assert.ok(fs.existsSync(d) && path.basename(d).startsWith("cwd-"));
  assert.equal(removeTempDir(d), true);
  assert.ok(!fs.existsSync(d));
  const other = tmpDir("not-ours-");
  assert.equal(removeTempDir(other), false, "a folder whose name does not start with cwd- is left alone");
  assert.ok(fs.existsSync(other));
  assert.equal(removeTempDir(null), false);
});

test("makeLiveWorld: a home, a config folder with onboarding done and the project trusted (both spellings of its path), the settings that were handed over, and no other file", () => {
  const base = tmpDir("cwd-live-");
  const w = makeLiveWorld(base, { settings: { user: { env: { A: "1" } }, project: { permissions: { deny: ["Bash"] } } } });
  const cj = JSON.parse(fs.readFileSync(path.join(w.cfg, ".claude.json"), "utf8"));
  assert.equal(cj.hasCompletedOnboarding, true);
  assert.equal(cj.projects[w.work].hasTrustDialogAccepted, true);
  assert.equal(cj.projects[w.work.replace(/\\/g, "/")].hasTrustDialogAccepted, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.cfg, "settings.json"), "utf8")), { env: { A: "1" } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.work, ".claude", "settings.json"), "utf8")), { permissions: { deny: ["Bash"] } });
  assert.ok(!fs.existsSync(path.join(w.work, ".claude", "settings.local.json")));
  assert.equal(w.debugFile, path.join(base, "debug.log"));
});
