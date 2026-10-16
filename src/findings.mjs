// The findings: what is probably not what you meant, from the facts that src/check.mjs collected. Each has an id (src/explain.mjs has a page for
// every id), a severity, a message, what Claude Code does about it, and a fix.
//   error    Claude Code does not start, or a tool is gone
//   warning  Claude Code works, but probably not the way you meant
//   note     worth knowing, nothing is lost
// "What Claude Code does" says only what the real binary was seen to do (README, "What was verified, and how"); where it comes from the
// documentation, or from Windows or git, the finding says so or leaves it out.
import { BLOCKING } from "./facts.mjs";
import { CLI_ORIGINS, ORIGIN_TEXT, compareVersions } from "./binaries.mjs";
import { CONFIG_NAMES } from "./userenv.mjs";
import { GIT_BASH_VAR, PS_VAR } from "./shell.mjs";

export const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };
const f = (id, severity, message, extra = {}) => ({ id, severity, message, effect: null, fix: null, ...extra });
const shown = (v) => (v === "" ? "(empty)" : v);
const age = (ms) => (ms === null || ms === undefined ? "" : ms < 90000 ? `${Math.round(ms / 1000)} seconds old` : ms < 5400000 ? `${Math.round(ms / 60000)} minutes old` : ms < 129600000 ? `${Math.round(ms / 3600000)} hours old` : `${Math.round(ms / 86400000)} days old`);

/** The findings of the Windows setup. `facts` is what collectWindows returns. */
export function windowsFindings(facts) {
  const out = [];
  const { shell, gitList = [], binaries, node, longPaths, git, policy, codePage, indexLock, userEnv, wsl, settingsFacts, wslBashOnPath, bashStarts } = facts;
  const bashVar = shell.gitBash.variableSource;
  const step = shell.gitBash.trail.find((t) => t.step === "variable");
  const found = gitList[0] ? gitList[0].path : null;

  // ---- the shell
  if (shell.fatal) {
    out.push(f("no-shell-tool", "error", `Claude Code will not start: it found no Git Bash, and the PowerShell tool is off (${PS_VAR} is "${shell.powershell.variable.value.trim()}" in ${shell.powershell.variable.source}).`, {
      effect: 'Claude Code exits at start with "Claude Code on Windows requires a shell tool" (exit code 1) and sends nothing.',
      fix: found ? `Remove ${PS_VAR}=0, or point ${GIT_BASH_VAR} at ${found}: claude-windows-doctor fix --git-bash.` : `Remove ${PS_VAR}=0 from ${shell.powershell.variable.source}, or install Git for Windows.`,
    }));
  }
  if (step && (step.state === "not-found" || step.state === "not-bash")) {
    const where = bashVar.source;
    out.push(f("git-bash-path-ignored", "warning", `${GIT_BASH_VAR} is "${step.value}" (${where}), and Claude Code ignores it: ${step.state === "not-found" ? "there is no such file" : "the file is not named bash.exe, sh.exe, bash or sh"}.${step.hint ? ` ${step.hint[0].toUpperCase()}${step.hint.slice(1)}.` : ""}`, {
      effect: `Claude Code looks for Git Bash as if the variable were not set${shell.gitBash.path ? `, and found ${shell.gitBash.path}` : ", and found none, so the Bash tool is not offered"}.`,
      fix: found ? `Point it at ${found}: claude-windows-doctor fix --git-bash.` : "Set it to the full path of bash.exe, or remove it.",
    }));
  }
  for (const ig of bashVar.ignored || []) {
    out.push(f("git-bash-path-project-settings", "warning", `${GIT_BASH_VAR} is set in the env of the ${ig.scope} settings (${ig.display}), which Claude Code does not use for it.`, {
      effect: "Only the process environment and the user settings count for this variable: the value there is not read, and Git Bash is looked for as if it were not set.",
      fix: found ? `Set it in the user environment instead: claude-windows-doctor fix --git-bash (it sets ${found}).` : "Put it in the env of your user settings.json, or in the user environment.",
    }));
  }
  if (!shell.gitBash.path && !shell.fatal && found && !(step && (step.state === "not-found" || step.state === "not-bash"))) {
    const wh = shell.gitBash.trail.find((t) => t.step === "where-git");
    let why;
    if (!wh || wh.lines === null) why = "where.exe could not look for git";
    else if (!wh.lines.length) why = "git.exe is not on PATH";
    else if (!wh.chosen) why = `no git.exe on PATH can be used (${(wh.skipped || []).map((s) => `${s.line}: ${s.reason}`).join("; ")})`;
    else why = `where git prints ${wh.chosen} first, and two folders up from it bin\\bash.exe would be ${wh.derived}, which is not there`;
    out.push(f("git-bash-not-found", "warning", `Git for Windows is installed (${found}), but Claude Code does not find it: ${why}.`, {
      effect: `The Bash tool is not offered; the model gets ${shell.tools.PowerShell === "yes" ? "the PowerShell tool only" : "no shell tool"}. Claude Code looks at ${GIT_BASH_VAR}, then C:\\Program Files\\Git and C:\\Program Files (x86)\\Git, then the first git.exe that where.exe lists.`,
      fix: `claude-windows-doctor fix --git-bash sets ${GIT_BASH_VAR}=${found} in the user environment (undo with claude-windows-doctor undo)${wh && wh.chosen && /\\mingw64\\bin\\git\.exe$/i.test(wh.chosen) ? "; or put the Git cmd folder before mingw64\\bin on PATH" : ""}.`,
    }));
  }
  if (bashStarts && bashStarts.checked && !bashStarts.ok) {
    out.push(f("git-bash-broken", "warning", `Claude Code would use ${shell.gitBash.path}, but it does not start (${bashStarts.error}).`, {
      effect: "The Bash tool is offered, and every command through it fails.",
      fix: "Repair or reinstall Git for Windows (bin\\bash.exe starts usr\\bin\\bash.exe, and one of them is gone or blocked).",
    }));
  }
  if (shell.powershell.unread) {
    out.push(f("powershell-variable-unread", "warning", `${PS_VAR} is "${shell.powershell.variable.value.trim()}" (${shell.powershell.variable.source}), which Claude Code reads as not set.`, {
      effect: "It is the same as not setting it. Claude Code reads 1, true, yes and on as on, and 0, false, no and off as off, in any case; anything else counts for nothing.",
      fix: `Write 1 or 0.`,
    }));
  }
  for (const d of settingsFacts.defaultShell) {
    out.push(f("default-shell-scope", "note", `defaultShell is "${d.value}" (${d.display}): it chooses the shell for the commands you type after ! in the prompt, not the tool the model gets.${d.valid ? "" : ' Claude Code takes only "bash" or "powershell" there.'}`, {
      effect: "The tools of the model's first request were the same with it and without it, with every value, in each state (put to the binary).",
      fix: `To change what the model gets, set ${PS_VAR} and ${GIT_BASH_VAR}.`,
    }));
  }
  if (shell.powershell.state === "yes" && shell.powershell.path && !shell.powershell.core) {
    out.push(f("powershell-5", "note", "The PowerShell tool will run Windows PowerShell 5.1: no pwsh (PowerShell 7) was found.", {
      effect: "The tool's own description tells the model that && and || are not available there, and that > and Out-File write the system code page unless told otherwise.",
      fix: "Install PowerShell 7 (winget install Microsoft.PowerShell): Claude Code uses pwsh when it finds it.",
    }));
  }
  if (wslBashOnPath && !shell.gitBash.path) {
    out.push(f("wsl-bash-on-path", "note", `bash.exe on PATH is the WSL launcher (${wslBashOnPath}), not a Git Bash.`, {
      effect: "Claude Code does not use it: with no variable and no git it offered the PowerShell tool only.",
      fix: "Install Git for Windows for a Bash tool, or leave it: the PowerShell tool does the work.",
    }));
  }

  // ---- the claude binaries
  const entries = binaries.entries;
  const onPath = entries.filter((e) => e.onPath);
  const clis = entries.filter((e) => CLI_ORIGINS.has(e.origin) && e.kind === "program");
  if (binaries.first && (binaries.first.origin === "desktop-launcher" || binaries.first.origin === "store-alias")) {
    out.push(f("claude-launcher-first", "warning", `The first claude on PATH is ${binaries.first.path}, ${ORIGIN_TEXT[binaries.first.origin]}.`, {
      effect: "Typing claude in a terminal starts that, not Claude Code's command line (this tool did not run it).",
      fix: "Put the folder of the claude command line you want before it on PATH, or remove the alias.",
    }));
  }
  if (!onPath.some((e) => e.kind === "program") && clis.length) {
    const e = clis[0];
    out.push(f("claude-not-on-path", "warning", `claude is installed (${e.path}, ${ORIGIN_TEXT[e.origin]}${e.version ? `, ${e.version}` : ""}), but its folder is not on PATH.`, {
      effect: 'A terminal says "claude is not recognized".',
      fix: `Add ${e.dir} to the user PATH (System Properties, Environment Variables), then open a new terminal.`,
    }));
  }
  const distinct = clis.filter((e, i, a) => a.findIndex((x) => x.origin === e.origin && x.dir === e.dir) === i);
  if (distinct.length > 1) {
    out.push(f("claude-multiple", "warning", `${distinct.length} claude command lines are installed: ${distinct.map((e) => `${e.path} (${ORIGIN_TEXT[e.origin]}${e.version ? `, ${e.version}` : ""}${e.runsFirst ? ", runs first" : ""})`).join("; ")}.`, {
      effect: `A terminal runs ${binaries.first ? binaries.first.path : "the first one on PATH"}; each install updates itself, or not, by its own rules.`,
      fix: "Keep one: uninstall the others (winget uninstall Anthropic.ClaudeCode, npm uninstall -g @anthropic-ai/claude-code, or delete .local\\bin\\claude.exe for the native one).",
    }));
  }
  if (binaries.first && binaries.first.version) {
    const newer = clis.find((e) => e !== binaries.first && e.version && compareVersions(e.version, binaries.first.version) > 0);
    if (newer) {
      out.push(f("claude-older-first", "warning", `The claude that runs first on PATH is ${binaries.first.version} (${binaries.first.path}), and ${newer.path} is ${newer.version}.`, {
        effect: "A terminal starts the older one.",
        fix: `Put ${newer.dir} before ${binaries.first.dir} on PATH, or remove the older install.`,
      }));
    }
  }
  for (const e of onPath) {
    if (e.kind === "program" && !e.skipped && e.version === null && e.note) {
      out.push(f("claude-no-version", "warning", `${e.path} ${e.note}.`, { effect: "That claude does not run here.", fix: "Reinstall it, or remove it from PATH." }));
    }
  }

  // ---- the platform
  if (node && node.npmFound && clis.some((e) => e.origin === "npm") && node.node && Number(node.node.split(".")[0]) < 22) {
    out.push(f("node-for-npm", "note", `Node is ${node.node}, and the npm package of Claude Code wants Node 22 or later.`, {
      effect: "npm prints an EBADENGINE warning when it installs the package; the install completes (Claude Code's documentation).",
      fix: "Nothing is needed for a claude that runs. For a clean install, use Node 22 or later, or the native installer, which needs no Node.",
    }));
  }
  if (longPaths && ((longPaths.ok && longPaths.enabled === false) || (git && git.ok && !(git.longpaths && git.longpaths.value === "true")))) {
    const parts = [];
    if (longPaths.ok && longPaths.enabled === false) parts.push("Windows' LongPathsEnabled is off");
    if (git && git.ok && !(git.longpaths && git.longpaths.value === "true")) parts.push(`git's core.longpaths is ${git.longpaths ? git.longpaths.value : "not set"}`);
    out.push(f("long-paths", "note", `Paths longer than 260 characters: ${parts.join(" and ")}.`, {
      effect: "From Windows' and git's documentation: a program that does not ask for long paths (git, npm, a compiler run through the shell) fails on a deep node_modules or build folder. Claude Code's own file tools wrote a file at a path of more than 300 characters (put to the binary; LongPathsEnabled was on).",
      fix: `${longPaths.ok && longPaths.enabled === false ? "Turn on LongPathsEnabled (an administrator: reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f). " : ""}${git && git.ok && !(git.longpaths && git.longpaths.value === "true") ? "git config --global core.longpaths true." : ""}`.trim(),
    }));
  }
  if (git && git.ok && git.autocrlf && git.autocrlf.value === "true") {
    out.push(f("autocrlf", "note", `git's core.autocrlf is true (${git.autocrlf.origin}).`, {
      effect: "Claude Code's Write tool wrote a new file with LF only and its Edit tool kept the CRLF of a file it changed (put to the binary). git converts line endings when it adds and checks out files, and warns \"LF will be replaced by CRLF\".",
      fix: "Nothing is wrong. To stop the conversion in a repository, set core.autocrlf false there and a .gitattributes with the endings you want.",
    }));
  }
  if (policy && policy.ok && policy.effective) {
    const eff = policy.effective;
    if (BLOCKING.has(eff.policy) && !eff.bypassed) {
      out.push(f("execution-policy", "warning", `The PowerShell execution policy is ${eff.policy} (${eff.scope}${eff.scope === "MachinePolicy" || eff.scope === "UserPolicy" ? ", set by Group Policy" : ""}), and Claude Code's PowerShell will not run .ps1 scripts.`, {
        effect: policy.respect ? `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY is on, so Claude Code no longer passes -ExecutionPolicy Bypass (put to the binary).` : "Claude Code starts PowerShell with -ExecutionPolicy Bypass at process scope (put to the binary), and a policy set by Group Policy still wins over it (its documentation).",
        fix: policy.respect ? "Remove CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY, or set a CurrentUser policy of RemoteSigned." : "Ask who manages the policy, or run scripts as commands (pwsh -File needs the policy too).",
      }));
    }
  }
  if (codePage && codePage.ok && codePage.active !== 65001 && shell.tools.Bash) {
    out.push(f("code-page", "note", `The console's code page is ${codePage.active}${codePage.oem ? ` (the system's OEM code page is ${codePage.oem})` : ""}, not UTF-8 (65001).`, {
      effect: "Output of a Windows program that prints in the console's code page, run through the Bash tool, reaches the model with replacement characters for anything that is not ASCII: cmd /c dir printed caf?-?ber.txt for café-über.txt under 437. The PowerShell tool sets 65001 and printed it right (put to the binary).",
      fix: "Run Windows programs through the PowerShell tool, or start Claude Code from a terminal set to UTF-8 (chcp 65001; not tried here).",
    }));
  }
  if (indexLock && indexLock.lock && indexLock.lock.gitRunning === false) {
    out.push(f("index-lock", "warning", `${indexLock.lock.path} exists (${age(indexLock.lock.ageMs)}) and no git process is running.`, {
      effect: "git commands in this repository fail with \"Unable to create index.lock: File exists\" until it is removed (git's behaviour).",
      fix: `Delete it: del "${indexLock.lock.path}".`,
    }));
  }

  // ---- the user environment
  if (userEnv && userEnv.ok) {
    for (const e of userEnv.entries) {
      const val = (side) => (side && side.value !== undefined ? ` (${shown(side.value)})` : "");
      if (e.status === "user-only") {
        out.push(f("user-env-not-in-process", "warning", `${e.name}${val(e.user)} is set in the Windows user environment, but not in this process.`, {
          effect: "A program reads the user environment once, when it starts: this terminal, and the desktop app or an editor that started before the variable was set, do not have it.",
          fix: "Open a new terminal, or restart the app, and run this again.",
        }));
      } else if (e.status === "differs") {
        out.push(f("user-env-differs", "warning", `${e.name} is not the same in the Windows user environment${val(e.user)} and in this process${val(e.process)}.`, {
          effect: "Programs started from the Start menu get the first, programs started from this terminal the second.",
          fix: "Set it once, in the user environment, and open a new terminal.",
        }));
      } else if (e.status === "process-only" && CONFIG_NAMES.includes(e.name.toUpperCase())) {
        out.push(f("process-env-not-in-user", "note", `${e.name}${val(e.process)} is set in this process only, not in the Windows user environment.`, {
          effect: "Other terminals, the desktop app and the editors do not have it.",
          fix: e.name.toUpperCase() === GIT_BASH_VAR && found ? "claude-windows-doctor fix --git-bash sets it for every program." : `Set it in the user environment (setx ${e.name} <value>) if you want it everywhere.`,
        }));
      }
    }
  }

  // ---- WSL, seen from Windows
  if (wsl && wsl.available && wsl.workable.length === 0) {
    out.push(f("wsl-no-distro", "note", `WSL has only distributions that other tools made for themselves (${wsl.distros.map((d) => d.name).join(", ")}${wsl.defaultName ? `; the default is ${wsl.defaultName}` : ""}): there is no Linux distribution to run Claude Code in.`, {
      effect: "The bash.exe launcher in System32 and wsl.exe open the default distribution, which is not one to work in.",
      fix: "wsl --install -d Ubuntu, if you want Claude Code in WSL. Nothing is needed otherwise.",
    }));
  }
  const inherit = (settingsFacts.wslInherits || []).find((w) => w.value === true || w.value === "true");
  if (inherit) {
    out.push(f("wsl-inherits-windows", "note", `wslInheritsWindowsSettings is on (${inherit.source}): Claude Code in WSL reads the managed settings of Windows.`, {
      effect: "From the documentation: WSL reads /etc/claude-code only when no Windows admin document is present. This was not put to the binary.",
      fix: "Nothing, unless a WSL session behaves like the Windows policy.",
    }));
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** The findings of a claude run inside WSL. */
export function wslFindings(facts) {
  const out = [];
  const { binaries, locations, wslInherits } = facts;
  if (binaries && binaries.first && binaries.first.origin === "windows") {
    out.push(f("wsl-windows-claude", "warning", `The claude that runs in this WSL distribution is a Windows program: ${binaries.first.path}.`, {
      effect: "It is the Windows Claude Code started through WSL: it sees Windows' folders and settings, not this distribution's, and the Bash tool runs Git Bash on Windows, not this shell.",
      fix: "Install Claude Code inside the distribution (curl -fsSL https://claude.ai/install.sh | bash) and put ~/.local/bin before the /mnt/c folders on PATH.",
    }));
  }
  if (locations) {
    if (locations.configOnWindows) {
      out.push(f("wsl-config-on-mnt", "warning", `The config folder is on a Windows drive (${locations.configDir}, from ${locations.configSource}).`, {
        effect: "Files on /mnt/c go through a network-like bridge, which is much slower for the many small files of transcripts and settings (WSL's documentation; not timed here).",
        fix: "Keep the config folder in the Linux home (~/.claude), and the projects there too.",
      }));
    } else if (locations.projectOnWindows) {
      out.push(f("wsl-config-on-mnt", "warning", `The project is on a Windows drive (${locations.project}).`, {
        effect: "Files on /mnt/c go through a network-like bridge: git, searches and builds are much slower than in the Linux home (WSL's documentation; not timed here).",
        fix: "Clone the project into the Linux home (~/code) and work there.",
      }));
    }
  }
  const inherit = (wslInherits || []).find((w) => w.value === true || w.value === "true");
  if (inherit) {
    out.push(f("wsl-inherits-windows", "note", `wslInheritsWindowsSettings is on (${inherit.source}): Claude Code in WSL reads the managed settings of Windows.`, { effect: "From the documentation; not put to the binary.", fix: "Nothing, unless a session here behaves like the Windows policy." }));
  }
  return out;
}

export function countFindings(findings) {
  const c = { error: 0, warning: 0, note: 0 };
  for (const x of findings) c[x.severity]++;
  return c;
}

