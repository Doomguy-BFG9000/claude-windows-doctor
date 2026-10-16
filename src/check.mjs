// `check`: collect what the machine says (everything read only), predict the shell, and find what is probably not what you meant.
// On Windows it checks the Windows setup; inside a WSL distribution the WSL side; on Linux and macOS there is nothing to check.
import { loadSettingsFiles, shellFacts } from "./settings.mjs";
import { parseSwitch, predictShell, resolveVariable } from "./shell.mjs";
import { discoverGitBash } from "./gitbash.mjs";
import { findClaudes } from "./binaries.mjs";
import { codePageFacts, executionPolicyFacts, gitFacts, indexLockFacts, longPathFacts, nodeFacts } from "./facts.mjs";
import { compareUserEnv } from "./userenv.mjs";
import { insideWsl, windowsWslFacts, wslLocations } from "./wsl.mjs";
import { countFindings, windowsFindings, wslFindings } from "./findings.mjs";

export const RESPECT_VAR = "CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY";

/** Does the Git Bash that Claude Code would use start? A read only try: `bash.exe -c "exit 0"`. */
export function bashStarts(sys, bashPath, cwd) {
  const r = sys.run(bashPath, ["-c", "exit 0"], { cwd: cwd && sys.isDir(cwd) ? cwd : undefined, timeout: 30000 });
  if (r.error) return { checked: true, ok: false, error: r.timedOut ? "it did not answer in 30 seconds" : `it could not be started: ${r.error.code || r.error.message}` };
  if (r.status !== 0) return { checked: true, ok: false, error: `it exited with code ${r.status}${String(r.stderr || "").trim() ? `: ${String(r.stderr).trim().split(/\r?\n/)[0].slice(0, 120)}` : ""}` };
  return { checked: true, ok: true, error: null };
}

/** The Windows setup. `dir` is a throwaway folder for the `--version` runs. */
export function collectWindows(sys, { project, userEnv, dir }) {
  const settings = loadSettingsFiles(sys, { project });
  const settingsFacts = shellFacts(settings);
  const cwd = settings.project;
  const shell = predictShell(sys, { cwd, facts: settingsFacts });
  const gitList = discoverGitBash(sys, { cwd });
  const starts = shell.gitBash.path ? bashStarts(sys, shell.gitBash.path, cwd) : { checked: false, ok: null, error: null };
  const binaries = findClaudes(sys, { dir });
  const respect = parseSwitch(resolveVariable(RESPECT_VAR, { processValue: sys.getEnv(RESPECT_VAR), facts: settingsFacts }).value) === true;
  const bashLines = sys.where("bash.exe", { cwd, env: sys.env }) || [];
  const launcher = bashLines.find((l) => /\\windows\\system32\\bash\.exe$/i.test(l) || /\\windowsapps\\bash\.exe$/i.test(l));
  const facts = {
    platform: "win32",
    kind: "windows",
    project: cwd,
    system: { os: sys.osVersion, release: sys.release, arch: sys.arch },
    settings: { configDir: settings.configDir, configSource: settings.configSource, files: settings.files.map((f) => ({ scope: f.scope, label: f.label, display: f.display, path: f.path, exists: f.exists, usable: f.usable, error: f.error ? f.error.message : null, applied: f.scope === "managed" ? Boolean(f.applied) : undefined })), managedApplied: settings.managedApplied },
    settingsFacts,
    shell,
    gitList,
    bashStarts: starts,
    binaries,
    node: nodeFacts(sys),
    longPaths: longPathFacts(sys),
    git: gitFacts(sys, cwd),
    policy: executionPolicyFacts(sys, { shell: shell.powershell.path || undefined, respect }),
    codePage: codePageFacts(sys),
    indexLock: indexLockFacts(sys, cwd),
    userEnv: compareUserEnv(sys, userEnv),
    wsl: windowsWslFacts(sys),
    wslBashOnPath: launcher || null,
  };
  facts.findings = windowsFindings(facts);
  facts.counts = countFindings(facts.findings);
  return facts;
}

/** The WSL side, from inside a distribution. */
export function collectWsl(sys, { project, dir }) {
  const inside = insideWsl(sys);
  const settings = loadSettingsFiles(sys, { project });
  const settingsFacts = shellFacts(settings);
  const binaries = findClaudes(sys, { dir });
  const locations = wslLocations(sys, project || sys.cwd);
  // the Windows policy, read through /mnt/c, tells whether this side inherits it
  const win = "/mnt/c/Program Files/ClaudeCode/managed-settings.json";
  const text = sys.readText(win);
  const wslInherits = [...settingsFacts.wslInherits];
  if (text) { try { const j = JSON.parse(text); if (j && j.wslInheritsWindowsSettings !== undefined) wslInherits.push({ source: "C:\\Program Files\\ClaudeCode\\managed-settings.json", display: win, value: j.wslInheritsWindowsSettings }); } catch { /* not JSON */ } }
  const facts = { platform: "linux", kind: "wsl", project: locations.project, system: { os: sys.osVersion, release: sys.release, arch: sys.arch, wsl: inside.version }, inside, settings: { configDir: settings.configDir, configSource: settings.configSource }, binaries, locations, wslInherits };
  facts.findings = wslFindings(facts);
  facts.counts = countFindings(facts.findings);
  return facts;
}

/** What `check` reports on a system with nothing to check. */
export function notApplicable(sys) {
  return { platform: sys.platform, kind: "other", applicable: false, system: { os: sys.osVersion, release: sys.release, arch: sys.arch }, findings: [], counts: { error: 0, warning: 0, note: 0 } };
}

/** The kind of system this is: "windows", "wsl" or "other". */
export function kindOf(sys) {
  if (sys.platform === "win32") return "windows";
  if (insideWsl(sys).inside) return "wsl";
  return "other";
}

