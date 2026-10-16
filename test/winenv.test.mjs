// The registry layer (reg.exe, through a pretend machine: the command lines are checked, and no registry is touched), and the file that stands
// in for it. Provenance of the parsing and the command lines: claude-relocate's test/winenv.test.mjs.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeMachine } from "./machine.mjs";
import { tmpDir } from "./helpers.mjs";
import { REAL_KEY, parseRegQuery, parseRegValues, readRegValue, regUserEnv } from "../src/winenv.mjs";
import { fileUserEnv } from "../src/write.mjs";

test("parseRegQuery reads the value, its type and a value with spaces; nothing for another name", () => {
  const text = "\r\nHKEY_CURRENT_USER\\Environment\r\n    CLAUDE_CODE_GIT_BASH_PATH    REG_SZ    D:\\Program Files\\Git\\bin\\bash.exe\r\n\r\n";
  assert.deepEqual(parseRegQuery(text, "CLAUDE_CODE_GIT_BASH_PATH"), { exists: true, type: "REG_SZ", value: "D:\\Program Files\\Git\\bin\\bash.exe" });
  assert.deepEqual(parseRegQuery(text, "OTHER"), { exists: false, type: null, value: null });
  assert.deepEqual(parseRegQuery("    claude_config_dir    REG_EXPAND_SZ    %USERPROFILE%\\x\r\n", "CLAUDE_CONFIG_DIR"), { exists: true, type: "REG_EXPAND_SZ", value: "%USERPROFILE%\\x" });
  assert.deepEqual(parseRegQuery("    CLAUDE_CONFIG_DIR    REG_SZ    \r\n", "CLAUDE_CONFIG_DIR"), { exists: true, type: "REG_SZ", value: "" });
  assert.deepEqual(parseRegQuery("", "X"), { exists: false, type: null, value: null });
  assert.equal(parseRegQuery("    LongPathsEnabled    REG_DWORD    0x1\r\n", "LongPathsEnabled").value, "0x1");
});

test("parseRegValues lists every value of a key and leaves the sub-keys out", () => {
  const text = "\r\nHKEY_CURRENT_USER\\Environment\r\n    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp\r\n    Path    REG_EXPAND_SZ    C:\\a;C:\\b c\r\n    ANTHROPIC_API_KEY    REG_SZ    sk-ant-secret\r\n\r\nHKEY_CURRENT_USER\\Environment\\Sub\r\n";
  assert.deepEqual(parseRegValues(text), [
    { name: "TEMP", type: "REG_EXPAND_SZ", value: "%USERPROFILE%\\AppData\\Local\\Temp" },
    { name: "Path", type: "REG_EXPAND_SZ", value: "C:\\a;C:\\b c" },
    { name: "ANTHROPIC_API_KEY", type: "REG_SZ", value: "sk-ant-secret" },
  ]);
});

const user = (values = {}, extra = {}) => fakeMachine({ registry: { [REAL_KEY]: values }, ...extra });

test("regUserEnv.read, list, write and remove put the right command lines to reg.exe, and write and remove broadcast the change", () => {
  const sys = user({ KEEP: ["REG_SZ", "kept"], CLAUDE_CODE_GIT_BASH_PATH: ["REG_EXPAND_SZ", "%USERPROFILE%\\Git\\bin\\bash.exe"] });
  const env = regUserEnv(sys);
  assert.equal(env.kind, "registry");
  assert.equal(env.key, "HKCU\\Environment");
  assert.deepEqual(env.read("CLAUDE_CODE_GIT_BASH_PATH"), { ok: true, exists: true, type: "REG_EXPAND_SZ", value: "%USERPROFILE%\\Git\\bin\\bash.exe", error: null });
  assert.deepEqual(env.read("NOPE"), { ok: true, exists: false, type: null, value: null, error: null });
  assert.deepEqual(env.list().values.map((v) => v.name).sort(), ["CLAUDE_CODE_GIT_BASH_PATH", "KEEP"]);
  const readCall = sys.runs.find((r) => /cmd/i.test(r.cmd));
  assert.deepEqual(readCall.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(readCall.args[3], /^"".*chcp.*" 65001>nul & ".*reg.*" query "HKCU\\Environment" \/v "CLAUDE_CODE_GIT_BASH_PATH""$/, "UTF-8 through chcp, every program by name, the whole line in one more pair of quotes");
  assert.equal(readCall.opts.verbatim, true);
  sys.runs.length = 0;
  assert.deepEqual(env.write("CLAUDE_CODE_GIT_BASH_PATH", "D:\\Program Files\\Git\\bin\\bash.exe"), { ok: true, error: null });
  const add = sys.runs.find((r) => r.args[0] === "add");
  assert.deepEqual(add.args, ["add", "HKCU\\Environment", "/v", "CLAUDE_CODE_GIT_BASH_PATH", "/t", "REG_SZ", "/d", "D:\\Program Files\\Git\\bin\\bash.exe", "/f"]);
  assert.ok(sys.runs.some((r) => /setx/i.test(r.cmd) && r.args[0] === "CLAUDE_WINDOWS_DOCTOR_NOTIFY"), "the broadcast");
  assert.ok(sys.runs.some((r) => r.args[0] === "delete" && r.args.includes("CLAUDE_WINDOWS_DOCTOR_NOTIFY")), "and its throwaway value goes again");
  assert.equal(env.read("CLAUDE_CODE_GIT_BASH_PATH").value, "D:\\Program Files\\Git\\bin\\bash.exe");
  assert.equal(env.read("CLAUDE_CODE_GIT_BASH_PATH").type, "REG_SZ");
  assert.deepEqual(env.write("CLAUDE_CODE_GIT_BASH_PATH", "%X%\\bash.exe", "REG_EXPAND_SZ"), { ok: true, error: null });
  assert.equal(env.read("CLAUDE_CODE_GIT_BASH_PATH").type, "REG_EXPAND_SZ", "a value can be put back with the type it had");
  sys.runs.length = 0;
  assert.deepEqual(env.remove("CLAUDE_CODE_GIT_BASH_PATH"), { ok: true, existed: true, error: null });
  assert.ok(sys.runs.some((r) => r.args[0] === "delete" && r.args.includes("CLAUDE_CODE_GIT_BASH_PATH") && r.args.includes("/f")));
  assert.deepEqual(env.remove("CLAUDE_CODE_GIT_BASH_PATH"), { ok: true, existed: false, error: null }, "removing what is not there is fine");
  assert.equal(env.read("KEEP").value, "kept", "nothing else was touched");
});

test("a failing or a missing reg.exe is reported with its message, and nothing is claimed", () => {
  const failing = fakeMachine({});
  const base0 = failing.run;
  failing.run = (cmd, args, opts) => (/reg/i.test(cmd) && args[0] === "add" ? { status: 1, stdout: "", stderr: "ERROR: Access is denied.", error: null, timedOut: false } : base0(cmd, args, opts));
  assert.match(regUserEnv(failing).write("X", "y").error, /reg add failed \(ERROR: Access is denied\.\)/);
  const missing = fakeMachine({ commands: {}, where: () => [] });
  missing.run = () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn reg ENOENT"), { code: "ENOENT" }), timedOut: false });
  assert.match(regUserEnv(missing).write("X", "y").error, /reg\.exe could not run/);
  assert.equal(regUserEnv(missing).read("X").ok, false);
  assert.equal(regUserEnv(missing).list().ok, false);
  assert.equal(regUserEnv(missing).remove("X").ok, false);
  const stuck = user({ X: ["REG_SZ", "1"] });
  const base = stuck.run;
  stuck.run = (cmd, args, opts) => (args[0] === "delete" && args.includes("X") ? { status: 1, stdout: "", stderr: "denied", error: null } : base(cmd, args, opts));
  assert.match(regUserEnv(stuck).remove("X").error, /reg delete failed \(denied\)/);
});

test("off Windows the registry has nothing", () => {
  const sys = fakeMachine({ platform: "linux" });
  assert.deepEqual(readRegValue(sys, "HKLM\\X", "Y"), { ok: true, exists: false, type: null, value: null, error: null });
  assert.deepEqual(regUserEnv(sys).list(), { ok: true, values: [], error: null });
});

test("the file that stands in for the user environment has the shape of the registry layer: list, read, write, remove, names in any case, a type that is kept", () => {
  const dir = tmpDir("cwd-fileenv-");
  const file = path.join(dir, "deep", "user-env.json");
  const env = fileUserEnv(file);
  assert.equal(env.kind, "file");
  assert.equal(env.key, file);
  assert.deepEqual(env.list(), { ok: true, values: [], error: null }, "a file that is not there is an empty environment");
  assert.deepEqual(env.read("A"), { ok: true, exists: false, type: null, value: null, error: null });
  assert.deepEqual(env.write("Claude_Code_Git_Bash_Path", "D:\\Git\\bin\\bash.exe"), { ok: true, error: null });
  assert.deepEqual(env.read("CLAUDE_CODE_GIT_BASH_PATH"), { ok: true, exists: true, type: "REG_SZ", value: "D:\\Git\\bin\\bash.exe", error: null }, "a name matches in any case");
  assert.deepEqual(env.write("CLAUDE_CODE_GIT_BASH_PATH", "%A%\\b.exe", "REG_EXPAND_SZ"), { ok: true, error: null });
  assert.equal(env.list().values.length, 1, "the same name in another case is the same value");
  assert.deepEqual(env.list().values[0], { name: "CLAUDE_CODE_GIT_BASH_PATH", type: "REG_EXPAND_SZ", value: "%A%\\b.exe" });
  assert.deepEqual(env.remove("claude_code_git_bash_path"), { ok: true, existed: true, error: null });
  assert.deepEqual(env.remove("claude_code_git_bash_path"), { ok: true, existed: false, error: null });
  fs.writeFileSync(file, "not json");
  assert.deepEqual(env.list().values, [], "a damaged file reads as an empty environment");
});
