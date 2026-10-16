// The only code that writes a file. It writes three things, and nothing else:
//   * the record of `fix --git-bash`, so that `undo` can put the user environment back: <config folder>/windows-doctor/record.json,
//     written through a temporary file and a rename, so nobody sees half a file;
//   * the throwaway folders in which the real claude binary is run (`check` asks each claude for its version in one, and `check --live`
//     runs the binary in one that holds its own config folder, a project folder and a copy of the few settings that decide the shell);
//   * the file that stands in for HKCU\Environment when CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE names one (the tests set it, so that no test can
//     change the registry of the machine it runs on).
// No settings file of the user, no ~/.claude.json, no registry value is written here (the registry is written by src/winenv.mjs, by `fix` and `undo` only).
import fs from "node:fs";
import path from "node:path";
import { VERSION } from "./version.mjs";

export const NAME = "claude-windows-doctor";
export const RECORD_SCHEMA = 1;

// ---- the record of fix ----------------------------------------------------------------------------------------------------------------

/** Where the record is, for a config folder. */
export const recordFileOf = (configDir, platform = process.platform) => (platform === "win32" ? path.win32.join(configDir, "windows-doctor", "record.json") : path.posix.join(configDir, "windows-doctor", "record.json"));

/** Writes the record: { name, key, value, previous, previousType, ... } plus the tool, the schema, the version and the date. Returns the file. */
export function writeRecord(file, fields, { now = Date.now() } = {}) {
  const record = { schema: RECORD_SCHEMA, tool: NAME, version: VERSION, date: new Date(now).toISOString(), ...fields };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

/** Reads a record: { ok, record } or { ok: false, missing, error }. */
export function readRecord(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return { ok: false, missing: e.code === "ENOENT", error: `cannot be read (${e.code || e.message})` }; }
  let record;
  try { record = JSON.parse(text.replace(/^﻿/, "")); } catch { return { ok: false, missing: false, error: "is not valid JSON" }; }
  if (!record || typeof record !== "object" || Array.isArray(record)) return { ok: false, missing: false, error: "is not a JSON object" };
  if (record.tool !== NAME) return { ok: false, missing: false, error: "was not written by claude-windows-doctor" };
  if (record.schema !== RECORD_SCHEMA) return { ok: false, missing: false, error: `has schema ${JSON.stringify(record.schema)}; this version reads schema ${RECORD_SCHEMA}` };
  for (const k of ["name", "key", "value"]) if (typeof record[k] !== "string" || !record[k]) return { ok: false, missing: false, error: `has no ${k}` };
  if (record.previous !== null && typeof record.previous !== "string") return { ok: false, missing: false, error: "has a previous value that is not text" };
  return { ok: true, record };
}

/** Deletes the record, and its folder when that is empty. */
export function deleteRecord(file) {
  fs.rmSync(file, { force: true });
  try { fs.rmdirSync(path.dirname(file)); } catch { /* not empty, or gone */ }
}

// ---- throwaway folders -----------------------------------------------------------------------------------------------------------------

/** A new empty folder under the temporary folder. */
export function makeTempDir(tmpdir, prefix = "cwd-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(tmpdir, prefix)));
}

/** Removes a folder that makeTempDir made (and refuses any other: its name must start with cwd-). */
export function removeTempDir(dir) {
  if (!dir || !path.basename(dir).startsWith("cwd-")) return false;
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { return false; }
}

/**
 * The folders of a live run: base/home, base/cfg (the config folder, with a .claude.json that has finished onboarding and trusts the project),
 * base/work (the project). `settings` is { user, project, local }: the objects to write as the settings files of those places.
 */
export function makeLiveWorld(base, { settings = {} } = {}) {
  const home = path.join(base, "home");
  const cfg = path.join(base, "cfg");
  const work = path.join(base, "work");
  for (const d of [home, cfg, work]) fs.mkdirSync(d, { recursive: true });
  const trust = { hasTrustDialogAccepted: true, allowedTools: [] };
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, projects: { [work]: trust, [work.replace(/\\/g, "/")]: trust } }));
  const put = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); };
  if (settings.user) put(path.join(cfg, "settings.json"), settings.user);
  if (settings.project) put(path.join(work, ".claude", "settings.json"), settings.project);
  if (settings.local) put(path.join(work, ".claude", "settings.local.json"), settings.local);
  return { base, home, cfg, work, debugFile: path.join(base, "debug.log") };
}

/** The text of the debug log that a live run wrote, or "". */
export function readDebugLog(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

// ---- the file that stands in for HKCU\Environment ---------------------------------------------------------------------------------------

/**
 * A user environment kept in a JSON file { "NAME": { "type": "REG_SZ", "value": "..." } }, with the shape of src/winenv.mjs's layer. Names match in any case, as in the registry.
 */
export function fileUserEnv(file) {
  const load = () => {
    try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
  };
  const save = (obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); };
  const find = (obj, name) => Object.keys(obj).find((k) => k.toLowerCase() === String(name).toLowerCase());
  return {
    kind: "file",
    key: file,
    list: () => ({ ok: true, values: Object.entries(load()).map(([name, v]) => ({ name, type: v.type || "REG_SZ", value: String(v.value ?? "") })), error: null }),
    read(name) {
      const obj = load();
      const k = find(obj, name);
      return k === undefined ? { ok: true, exists: false, type: null, value: null, error: null } : { ok: true, exists: true, type: obj[k].type || "REG_SZ", value: String(obj[k].value ?? ""), error: null };
    },
    write(name, value, type = "REG_SZ") {
      const obj = load();
      const k = find(obj, name);
      if (k !== undefined) delete obj[k];
      obj[name] = { type, value };
      save(obj);
      return { ok: true, error: null };
    },
    remove(name) {
      const obj = load();
      const k = find(obj, name);
      if (k === undefined) return { ok: true, existed: false, error: null };
      delete obj[k];
      save(obj);
      return { ok: true, existed: true, error: null };
    },
  };
}
