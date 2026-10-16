// `fix --git-bash` and `undo`: the only commands that change anything, and the only thing they change is one value of the Windows user
// environment, CLAUDE_CODE_GIT_BASH_PATH, so that Claude Code finds a Git Bash that it does not look for by itself (every program
// started afterwards has it). `fix` records what was there before in <config folder>/windows-doctor/record.json; `undo` puts that back
// (the old value with its old registry type, or no value at all) and deletes the record. Both refuse on a system that is not Windows,
// and both take --dry-run. The registry is reached through the `userEnv` layer (src/winenv.mjs), which the tests replace with a file.
import { configDirOf, loadSettingsFiles, shellFacts } from "./settings.mjs";
import { GIT_BASH_VAR, checkBashValue, predictShell } from "./shell.mjs";
import { discoverGitBash } from "./gitbash.mjs";
import { deleteRecord, readRecord, recordFileOf, writeRecord } from "./write.mjs";
import * as W from "./winpath.mjs";

// where the record is kept: files, in a real run; the tests put a pretend store in its place
export const fileStore = { read: readRecord, write: writeRecord, remove: deleteRecord };

const NOT_WINDOWS = "works on Windows only: it changes a variable of the Windows user environment";

function base(sys, userEnv, dryRun, extra = {}) {
  return { ok: false, refused: null, reason: null, dryRun: Boolean(dryRun), action: null, name: GIT_BASH_VAR, key: userEnv.key, layer: userEnv.kind, value: null, previous: null, via: null, record: null, notes: [], ...extra };
}
const refuse = (r, reason, message) => ({ ...r, ok: false, refused: message, reason });

/** A --path value as a bash.exe: a file named bash.exe (or sh.exe, bash, sh), or a Git for Windows folder (the one with bin\bash.exe, or its bin folder). */
export function resolveBashArg(sys, arg) {
  const raw = String(arg).trim().replace(/^"(.*)"$/, "$1");
  if (!W.isAbsolute(raw)) return { ok: false, message: `--path must be an absolute path (${raw})` };
  const file = checkBashValue(raw, sys);
  if (file.state === "valid" && sys.isFile(raw)) return { ok: true, path: W.join(raw) };
  for (const rel of [["bin", "bash.exe"], ["bash.exe"]]) {
    const p = W.join(raw, ...rel);
    if (sys.isFile(p)) return { ok: true, path: p };
  }
  if (sys.isDir(raw)) return { ok: false, message: `no bash.exe in ${raw} (pass the file, or a Git for Windows folder with bin\\bash.exe in it)` };
  return { ok: false, message: file.state === "not-bash" ? `${raw} is not a bash.exe (the file must be named bash.exe, sh.exe, bash or sh)` : `${raw} does not exist` };
}

/** Where a record of an earlier fix would be: the config folder in use, then the default one. */
export function recordPlaces(sys) {
  const cfg = configDirOf(sys);
  const places = [recordFileOf(cfg.dir, "win32")];
  const fallback = recordFileOf(W.join(sys.home, ".claude"), "win32");
  if (W.key(fallback) !== W.key(places[0])) places.push(fallback);
  return places;
}

export function runFix(sys, { userEnv, project, bashPath, dryRun = false, now = Date.now(), store = fileStore } = {}) {
  const r0 = base(sys, userEnv, dryRun);
  if (sys.platform !== "win32") return refuse(r0, "not-windows", `fix --git-bash ${NOT_WINDOWS}.`);
  const settings = loadSettingsFiles(sys, { project });
  const facts = shellFacts(settings);
  const cwd = settings.project;
  const prediction = predictShell(sys, { cwd, facts });
  const variable = prediction.gitBash.variableSource;
  const notes = [];

  // the user settings and the managed settings set the variable above the user environment: a value there is not one that `fix` can replace
  if (variable.scope === "user" || variable.scope === "managed") {
    const state = checkBashValue(variable.value, sys);
    if (state.state === "valid") return { ...r0, ok: true, action: "nothing", value: state.value, notes: [`${GIT_BASH_VAR} is already set to ${state.value} in the ${variable.source}: Claude Code uses it, and a value in the user environment would not change that. Nothing to fix.`] };
    return refuse(r0, "settings-env", `${GIT_BASH_VAR} is set in the ${variable.source} (${variable.display}) and ${state.state === "unset" ? "is empty" : `is ignored by Claude Code (${state.state === "not-found" ? "there is no such file" : "not a bash.exe"})`}; the settings win over the user environment, so fix cannot help. Change the value in that file, or remove it.`);
  }

  // the file to point at
  let target;
  let via;
  if (bashPath) {
    const r = resolveBashArg(sys, bashPath);
    if (!r.ok) return refuse(r0, "bad-path", r.message);
    target = r.path;
    via = "--path";
  } else {
    const own = checkBashValue(variable.value, sys);
    if (own.state === "valid") { target = own.value; via = `the ${variable.source} (it works there, and not in other programs)`; }
    else if (prediction.gitBash.path && prediction.gitBash.how !== "variable") {
      return { ...r0, ok: true, action: "nothing", value: prediction.gitBash.path, via: prediction.gitBash.how, notes: [`Claude Code finds Git Bash by itself, at ${prediction.gitBash.path} (${HOW_TEXT[prediction.gitBash.how]}). Nothing to fix.`, "That depends on PATH: a terminal that lists ...\\Git\\mingw64\\bin before ...\\Git\\cmd (Git Bash itself does) does not find it. To set it for every program anyway, pass --path <bash.exe>."] };
    } else {
      const found = discoverGitBash(sys, { cwd });
      if (!found.length) return refuse(r0, "no-git-bash", "No Git Bash was found on this machine (not on PATH, not where Git for Windows records its install, not in the usual folders). Install Git for Windows, or pass --path <bash.exe>.");
      target = found[0].path;
      via = found[0].via;
      if (found.length > 1) notes.push(`${found.length} Git Bash files were found; the first is used (pass --path to choose): ${found.map((x) => x.path).join(", ")}.`);
    }
  }

  const before = userEnv.read(GIT_BASH_VAR);
  if (!before.ok) return refuse(r0, "read-failed", `The user environment could not be read: ${before.error}`);
  const previous = before.exists ? { value: before.value, type: before.type } : null;
  const wanted = W.toBackslash(target);
  if (before.exists && W.same(before.value, wanted)) {
    return { ...r0, ok: true, action: "nothing", value: wanted, previous, via, notes: [`${GIT_BASH_VAR} is already ${wanted} in the user environment. Nothing to do.`] };
  }
  const files = recordPlaces(sys);
  const plan = { ...r0, action: "set", value: wanted, previous, via, record: files[0], notes };
  if (previous) plan.notes = [...notes, `The value now there, ${previous.value} (${previous.type}), is saved in the record, and \`undo\` puts it back.`];
  if (dryRun) return { ...plan, ok: true, notes: [...plan.notes, "Nothing was changed (--dry-run)."] };

  const w = userEnv.write(GIT_BASH_VAR, wanted, "REG_SZ");
  if (!w.ok) return refuse(r0, "write-failed", `The user environment could not be changed: ${w.error}`);
  try {
    store.write(files[0], { action: "git-bash", platform: "win32", key: userEnv.key, layer: userEnv.kind, name: GIT_BASH_VAR, value: wanted, previous: previous ? previous.value : null, previousType: previous ? previous.type : null, via }, { now });
  } catch (e) {
    // no record, no change: put the value back
    if (previous) userEnv.write(GIT_BASH_VAR, previous.value, previous.type); else userEnv.remove(GIT_BASH_VAR);
    return refuse(r0, "record-failed", `The record could not be written (${e.code || e.message}), so the user environment was put back as it was.`);
  }
  return { ...plan, ok: true, notes: [...plan.notes, "Programs started from now on have it: open a new terminal, and restart the desktop app or the editor that was already running."] };
}

const HOW_TEXT = {
  "program-files": "the fixed path C:\\Program Files\\Git",
  "program-files-x86": "the fixed path C:\\Program Files (x86)\\Git",
  "where-git": "the first git.exe on PATH",
};

export function runUndo(sys, { userEnv, dryRun = false, store = fileStore } = {}) {
  const r0 = base(sys, userEnv, dryRun);
  if (sys.platform !== "win32") return refuse(r0, "not-windows", `undo ${NOT_WINDOWS}.`);
  let file = null;
  let rec = null;
  for (const p of recordPlaces(sys)) {
    const r = store.read(p);
    if (r.ok) { file = p; rec = r.record; break; }
    if (!r.missing) return refuse({ ...r0, record: p }, "bad-record", `The record ${p} ${r.error}. Delete it by hand if fix did not write it, or restore the variable yourself: it is ${GIT_BASH_VAR} in the user environment.`);
  }
  if (!rec) return { ...r0, ok: true, action: "nothing", notes: [`No record of a fix was found (looked at ${recordPlaces(sys).join(", ")}). There is nothing to undo.`] };
  const now = userEnv.read(rec.name);
  if (!now.ok) return refuse({ ...r0, record: file }, "read-failed", `The user environment could not be read: ${now.error}`);
  const out = { ...r0, record: file, name: rec.name, value: rec.value, previous: rec.previous === null ? null : { value: rec.previous, type: rec.previousType || "REG_SZ" } };
  if (!now.exists || !W.same(now.value, rec.value)) {
    const what = !now.exists ? `${rec.name} is not set in the user environment any more` : `${rec.name} is ${now.value} in the user environment now, not the ${rec.value} that fix set`;
    if (dryRun) return { ...out, ok: true, action: "forget", notes: [`${what}: it would be left as it is, and the record deleted. Nothing was changed (--dry-run).`] };
    store.remove(file);
    return { ...out, ok: true, action: "forget", notes: [`${what}: left as it is, and the record deleted.`] };
  }
  const restoring = rec.previous !== null;
  const text = restoring ? `put ${rec.name} back to ${rec.previous} (${rec.previousType || "REG_SZ"})` : `remove ${rec.name} from the user environment`;
  if (dryRun) return { ...out, ok: true, action: restoring ? "restore" : "remove", notes: [`Would ${text}, and delete the record. Nothing was changed (--dry-run).`] };
  const w = restoring ? userEnv.write(rec.name, rec.previous, rec.previousType || "REG_SZ") : userEnv.remove(rec.name);
  if (!w.ok) return refuse(out, "write-failed", `The user environment could not be changed: ${w.error}. The record is kept.`);
  store.remove(file);
  return { ...out, ok: true, action: restoring ? "restore" : "remove", notes: [`${text[0].toUpperCase()}${text.slice(1)}, and the record deleted. Programs started from now on have the old value.`] };
}

