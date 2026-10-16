// The Windows registry, as far as this tool needs it: reading values (the user environment in HKCU\Environment, the long-path
// switch, the managed settings, where Git for Windows says it is installed), and one writer for `fix` and `undo`: a value in the
// user environment, which every program started after the change (a terminal from the Start menu, Windows Terminal, VS Code,
// Git Bash) inherits. Written and read with reg.exe; no other program is needed.
//
// Provenance: parseRegQuery, the reg.exe command line (UTF-8 through chcp 65001, whole path of each program, /s quoting for
// cmd.exe), the write with the old type kept, and the broadcast are claude-relocate's src/winenv.mjs; what is new here is a
// layer with the same shape that reads and writes a file instead (src/write.mjs), so that no test can reach the real registry.
//
// The layer (`userEnv`) has the shape:
//   kind: "registry" | "file", key: the registry key or the file
//   list()                      { ok, values: [{ name, type, value }], error }
//   read(name)                  { ok, exists, type, value, error }
//   write(name, value, type)    { ok, error }
//   remove(name)                { ok, existed, error }
import { programPath } from "./sys.mjs";

export const REAL_KEY = "HKCU\\Environment";

// `reg query <key> /v <name>` prints
//
//   HKEY_CURRENT_USER\Environment
//       CLAUDE_CODE_GIT_BASH_PATH    REG_SZ    E:\Das\Git\bin\bash.exe
//
// -> { exists, type, value }.
export function parseRegQuery(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s+(\S.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*?))?\s*$/.exec(line) || /^\s+(\S+)\s+(REG_[A-Z_]+)(?:\s{2,}(.*?))?\s*$/.exec(line);
    if (m && m[1].toLowerCase() === String(name).toLowerCase()) return { exists: true, type: m[2], value: m[3] ?? "" };
  }
  return { exists: false, type: null, value: null };
}

/** Every value that `reg query <key>` lists: [{ name, type, value }] (the sub-keys it also lists are left out). */
export function parseRegValues(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) continue;
    const m = /^\s+(\S.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*?))?\s*$/.exec(line) || /^\s+(\S+)\s+(REG_[A-Z_]+)(?:\s{2,}(.*?))?\s*$/.exec(line);
    if (m) out.push({ name: m[1], type: m[2], value: m[3] ?? "" });
  }
  return out;
}

// reg prints in the console's code page, which turns é or 日本語 into other characters; a console set to UTF-8 (chcp 65001) prints
// them as they are. cmd.exe looks in the working folder first for the programs it is asked to run, so they are named by their
// full path, and /s takes off the first and the last quote of the line, so the whole line is in one more pair.
function regCommand(sys, args) {
  const opts = { platform: sys.platform, env: sys.env };
  const line = `"${programPath("chcp.com", opts)}" 65001>nul & "${programPath("reg.exe", opts)}" ${args}`;
  return sys.run("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { verbatim: true, timeout: 30000 });
}

/** One value of a registry key: { ok, exists, type, value, error }. A key or a value that is not there is not an error. */
export function readRegValue(sys, key, name) {
  if (sys.platform !== "win32") return { ok: true, exists: false, type: null, value: null, error: null };
  const r = regCommand(sys, `query "${key}" /v "${name}"`);
  if (r.error) return { ok: false, exists: false, type: null, value: null, error: `reg.exe could not run (${r.error.message})` };
  // reg exits 1 both for "no such value" and for "no such key"
  if (r.status !== 0) return { ok: true, exists: false, type: null, value: null, error: null };
  return { ok: true, ...parseRegQuery(r.stdout, name), error: null };
}

/** The Windows registry's user environment (HKCU\Environment). */
export function regUserEnv(sys) {
  const fail = (what, r) => `${what} failed (${String(r.stderr || r.stdout || "").trim().slice(0, 160) || `exit ${r.status}`})`;
  const layer = {
    kind: "registry",
    key: REAL_KEY,
    list() {
      if (sys.platform !== "win32") return { ok: true, values: [], error: null };
      const r = regCommand(sys, `query "${REAL_KEY}"`);
      if (r.error) return { ok: false, values: [], error: `reg.exe could not run (${r.error.message})` };
      if (r.status !== 0) return { ok: true, values: [], error: null };
      return { ok: true, values: parseRegValues(r.stdout), error: null };
    },
    read: (name) => readRegValue(sys, REAL_KEY, name),
    // Sets the value (a string value, REG_SZ, which is not expanded, unless the value being put back had another type).
    write(name, value, type = "REG_SZ") {
      const r = sys.run("reg", ["add", REAL_KEY, "/v", name, "/t", type, "/d", value, "/f"]);
      if (r.error) return { ok: false, error: `reg.exe could not run (${r.error.message})` };
      if (r.status !== 0) return { ok: false, error: fail("reg add", r) };
      broadcast(sys);
      return { ok: true, error: null };
    },
    // Removes the value. A value that is not there counts as removed.
    remove(name) {
      const had = layer.read(name);
      if (!had.ok) return { ok: false, existed: false, error: had.error };
      if (!had.exists) return { ok: true, existed: false, error: null };
      const r = sys.run("reg", ["delete", REAL_KEY, "/v", name, "/f"]);
      if (r.error) return { ok: false, existed: true, error: `reg.exe could not run (${r.error.message})` };
      if (r.status !== 0) return { ok: false, existed: true, error: fail("reg delete", r) };
      broadcast(sys);
      return { ok: true, existed: true, error: null };
    },
  };
  return layer;
}

// Windows tells running programs about a changed user environment with a broadcast, and `setx` sends one. A plain registry
// write does not, so on versions of Windows where Explorer keeps its own copy until told, a terminal started from the Start menu
// would still see the old value. Writing and deleting a throwaway value with setx sends the broadcast. Never an error.
// (claude-relocate's broadcast; this tool's own throwaway name.)
export function broadcast(sys) {
  try {
    sys.run("setx", ["CLAUDE_WINDOWS_DOCTOR_NOTIFY", "1"]);
    sys.run("reg", ["delete", REAL_KEY, "/v", "CLAUDE_WINDOWS_DOCTOR_NOTIFY", "/f"]);
    return true;
  } catch {
    return false;
  }
}
