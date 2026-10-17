// `explain <finding-id>`: what a finding means, what Claude Code does in that case, the fix, and the issue thread. Each line of "does" is
// marked: V was seen in a real run (of the claude binary, or of the Windows program that the line names; README, "What was verified, and
// how"), D is documentation (Claude Code's, Windows', git's), N was not verified here.
// There is a page for every id that src/findings.mjs can emit (test/explain.test.mjs holds the two lists to each other).
const ISSUE = (n, title) => ({ number: n, title, url: `https://github.com/anthropics/claude-code/issues/${n}` });

export const PAGES = [
  {
    id: "no-shell-tool", title: "Claude Code will not start: no Git Bash and the PowerShell tool is off",
    means: "On Windows Claude Code needs a shell tool: Git Bash, or the PowerShell tool. This machine has neither as far as Claude Code can tell, because CLAUDE_CODE_USE_POWERSHELL_TOOL says off (0, false, no or off) and Git Bash is not found.",
    does: [
      'V: Claude Code exits at start with code 1 and the text "Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled (CLAUDE_CODE_USE_POWERSHELL_TOOL=0)". It sends no request.',
      "V: it does so for the variable in the process environment and in the env of the user, project and local settings, and for a number 0 or a boolean false written in a settings file.",
      "V: with Git Bash found, the same variable only takes the PowerShell tool away, and Claude Code starts.",
    ],
    fix: ["Remove CLAUDE_CODE_USE_POWERSHELL_TOOL=0 from the environment and the settings files (the report names where it is set).", "Or make Git Bash found: claude-windows-doctor fix --git-bash."],
    issues: [ISSUE(25593, "Install - Claude Code on Windows requires git-bash - after git installed and Path added to Env (closed)"), ISSUE(11496, "Error: Claude Code on Windows requires git-bash (closed): the wording of an older version")],
  },
  {
    id: "git-bash-not-found", title: "Git for Windows is installed, but Claude Code does not find its bash.exe",
    means: "Claude Code gives the model a Bash tool only when it finds Git Bash. It does not search the disk: it looks in three places, in this order, and the first hit wins. This machine has a Git for Windows that none of the three leads to.",
    does: [
      "V: 1. CLAUDE_CODE_GIT_BASH_PATH, when it names an existing file called bash.exe, sh.exe, bash or sh. 2. C:\\Program Files\\Git\\bin\\bash.exe, then C:\\Program Files (x86)\\Git\\bin\\bash.exe, written out (the ProgramFiles variable is not read). 3. The first line that `where.exe git` prints that exists, is not in the working folder and ends in .com, .exe, .bat or .cmd: two folders up from that file, bin\\bash.exe.",
      "V: step 3 works for ...\\Git\\cmd\\git.exe (the folder Git for Windows puts on PATH) and fails for ...\\Git\\mingw64\\bin\\git.exe, which is two folders up from mingw64, not from the Git folder. Only the first line counts: with mingw64\\bin before cmd on PATH, Git Bash is not found, with cmd first it is. Git Bash itself starts with mingw64\\bin first, so a Claude Code started from Git Bash on a Git that is not under C:\\Program Files does not find it.",
      "V: with no Git Bash the model gets the PowerShell tool only (the default when Git Bash is not found), and the debug log says \"Git Bash not found; BashTool will be unavailable\".",
      "V: a bash.exe in C:\\Windows\\System32 (the WSL launcher) on PATH is not used.",
    ],
    fix: ["claude-windows-doctor fix --git-bash sets CLAUDE_CODE_GIT_BASH_PATH in the user environment, with a record; claude-windows-doctor undo removes it.", "Or set CLAUDE_CODE_GIT_BASH_PATH yourself (setx CLAUDE_CODE_GIT_BASH_PATH \"E:\\Das\\Git\\bin\\bash.exe\"), or put the Git cmd folder before mingw64\\bin on PATH.", "Programs that were already running do not see a changed environment: open a new terminal, and restart the desktop app or the editor."],
    issues: [ISSUE(8674, "Claude Code VS Code Extension Fails to Detect Git Bash on Windows Despite Correct Configuration (closed, 68 comments)"), ISSUE(13184, "`requires git-bash` error persists on Windows even when CLAUDE_CODE_GIT_BASH_PATH and symlink are set (closed)")],
  },
  {
    id: "git-bash-path-ignored", title: "CLAUDE_CODE_GIT_BASH_PATH is set, and Claude Code ignores it",
    means: "The variable names a file that Claude Code does not accept, so it looks for Git Bash as if the variable were not set.",
    does: [
      "V: a value is accepted when its file name is bash.exe, sh.exe, bash or sh (any case) and it exists. Forward and back slashes both work, a space before or after the path is trimmed, and a folder named bash.exe is accepted (only the name and that it exists are checked).",
      "V: it is ignored when the name is something else (git-bash.exe, git.exe, the bin folder), when the value is in quote marks (they are part of the value), when it has a %NAME% in it (not expanded), when it is a relative path, and when the file is not there. The debug log says which: `... is not a bash/sh binary; falling back to auto-detection` or `... not found; falling back to auto-detection`.",
      "V: an empty value is the same as not set.",
      "D: before Claude Code 2.1.219 a path that did not exist stopped Claude Code at start; the 2.1.295 and 2.1.299 that were tried carry on.",
    ],
    fix: ["Set the full path of bash.exe, without quotes: claude-windows-doctor fix --git-bash.", "A value written with setx or in System Properties is a plain string: write the whole path, not %ProgramFiles%\\Git\\bin\\bash.exe."],
    issues: [ISSUE(13184, "`requires git-bash` error persists on Windows even when CLAUDE_CODE_GIT_BASH_PATH and symlink are set (closed)"), ISSUE(8674, "Claude Code VS Code Extension Fails to Detect Git Bash on Windows Despite Correct Configuration (closed)")],
  },
  {
    id: "git-bash-path-project-settings", title: "CLAUDE_CODE_GIT_BASH_PATH is in a project or local settings file, where it is not used",
    means: "Claude Code's documentation says to put CLAUDE_CODE_GIT_BASH_PATH in the env of settings.json. That works in the user settings (~/.claude/settings.json). In the project's .claude/settings.json and .claude/settings.local.json it does not.",
    does: [
      "V: the value in the env of the user settings was used (and replaced a different value in the process environment); the same value in the env of the project settings, and of the local settings, was not: Git Bash was looked for as if it were not set.",
      "V: CLAUDE_CODE_USE_POWERSHELL_TOOL, in contrast, is used from the user, project and local settings, the nearest file winning, and above the process environment.",
      "D: Claude Code's settings reference says a repository must not control variables that pick the programs a process starts.",
    ],
    fix: ["Put it in the user settings or in the user environment: claude-windows-doctor fix --git-bash."],
    issues: [],
  },
  {
    id: "git-bash-broken", title: "Git Bash is found, and does not start",
    means: "Claude Code checks that the bash.exe exists, not that it works. Git for Windows' bin\\bash.exe starts usr\\bin\\bash.exe, so a half removed or blocked install passes the check and fails at every command.",
    does: ["V: Claude Code offered the Bash tool for a bash.exe that was only a file name that exists (it does not start it to find out).", "N: what the Bash tool says when its bash.exe cannot start was not put to the binary; the thread below shows the text a user saw."],
    fix: ["Reinstall Git for Windows, or point CLAUDE_CODE_GIT_BASH_PATH at a bash.exe that starts.", "Try it yourself: <path to bash.exe> -c \"echo ok\"."],
    issues: [ISSUE(98901, "defaultShell: \"powershell\" setting not honored on Windows - Bash tool fails (the bin\\bash.exe of that report could not find usr\\bin\\bash.exe)")],
  },
  {
    id: "powershell-variable-unread", title: "CLAUDE_CODE_USE_POWERSHELL_TOOL is set to a value Claude Code does not read",
    means: "The variable is a switch. Claude Code reads some spellings and ignores the rest, so the value does nothing.",
    does: [
      "V: on: 1, true, yes, on. Off: 0, false, no, off. Any case, and spaces or a tab around the value are trimmed.",
      "V: anything else (an empty value, 2, enabled, y, t, 1.0, -1, 00, yes please, null) counts as not set: the tool is on when Git Bash is not found, and decided by the account when it is.",
    ],
    fix: ["Write 1 to turn the PowerShell tool on, or 0 to turn it off."],
    issues: [],
  },
  {
    id: "default-shell-scope", title: "defaultShell is not the shell the model gets",
    means: "The defaultShell setting chooses whether the commands you type after ! in the prompt run in Bash or PowerShell. Many people set it expecting the model's Bash tool to change.",
    does: [
      "V: the tools of the first request were the same with defaultShell \"bash\", \"powershell\" and \"cmd\" (not a value it allows) and without it, in each of three states (Bash only, both tools, PowerShell only), in the user settings and in the project settings; the whole request had the same size.",
      "D: the settings reference says it is for the input-box ! commands, that \"powershell\" works only while the PowerShell tool is on, and that it falls back to the other shell when the one named is not there.",
      "N: the ! commands themselves need a session you type in; they were not driven.",
    ],
    fix: ["To change the tools the model gets: CLAUDE_CODE_USE_POWERSHELL_TOOL (1 or 0), CLAUDE_CODE_GIT_BASH_PATH, and a deny rule Bash or PowerShell in permissions.deny."],
    issues: [ISSUE(98901, "defaultShell: \"powershell\" setting not honored on Windows - Bash tool fails"), ISSUE(7490, "Allow users to configure which shell the Bash tool uses or inherit initial shell (148 reactions)")],
  },
  {
    id: "powershell-5", title: "The PowerShell tool runs Windows PowerShell 5.1",
    means: "Claude Code uses PowerShell 7 (pwsh) when it finds it and Windows PowerShell 5.1 otherwise.",
    does: [
      "V: it looks for pwsh on PATH, then PowerShell\\7\\pwsh.exe in the Program Files folder that ProgramW6432 names, then .dotnet\\tools\\pwsh.exe in the home folder, then powershell on PATH, then System32's. The edition is on the second line of the tool's description: \"Windows PowerShell 5.1 (powershell.exe)\" or \"PowerShell 7+ (pwsh)\".",
      "V: for 5.1 the description tells the model that && and || and ?: are not available.",
      "N: a Microsoft Store alias of pwsh (WindowsApps) is modelled by this tool, not tried.",
    ],
    fix: ["winget install Microsoft.PowerShell, then open a new terminal."],
    issues: [ISSUE(98104, "Heredoc syntax not supported on Windows PowerShell despite explicit rules to prevent usage")],
  },
  {
    id: "wsl-bash-on-path", title: "bash.exe on PATH is the WSL launcher",
    means: "C:\\Windows\\System32\\bash.exe starts the default WSL distribution. It is not Git Bash.",
    does: ["V: with only System32 on PATH (so with that bash.exe on it) and no variable and no Git, Claude Code offered the PowerShell tool only: it does not use the WSL bash.exe.", "N: a Git Bash that is found while a WSL bash comes first on PATH inside a command was not tried."],
    fix: ["Install Git for Windows if you want the Bash tool, or leave it."],
    issues: [ISSUE(26505, "v2.1.45 Windows: Bash tool fails silently (exit code 1) when WSL bash is on PATH alongside Git Bash (closed)")],
  },
  {
    id: "claude-launcher-first", title: "The first claude on PATH is not the command line",
    means: "claude.exe in the desktop app's folder, or a Microsoft Store alias of it, opens the desktop app.",
    does: ["N: this tool never runs those files; it names them from their place."],
    fix: ["Put the folder of the claude command line first on PATH, or remove the alias (Settings, Apps, Advanced app settings, App execution aliases)."],
    issues: [],
  },
  {
    id: "claude-not-on-path", title: "claude is installed and its folder is not on PATH",
    means: "The installer put claude somewhere that PATH does not list, so a terminal does not know the command.",
    does: ["V: for an install that is not from npm (the desktop app's bundle here), claude doctor prints the same: \"Native installation exists but ...\\.local\\bin is not in your PATH\" (2.1.295 and 2.1.299). For an npm install (2.1.301 in CI) it says \"No installation issues found\" and nothing about PATH.", "D: the native installer's folder is %USERPROFILE%\\.local\\bin; npm's is its global prefix (usually %APPDATA%\\npm); WinGet links into %LOCALAPPDATA%\\Microsoft\\WinGet\\Links."],
    fix: ["Add the folder to the user PATH (System Properties, Environment Variables, Path, New), then open a new terminal."],
    issues: [],
  },
  {
    id: "claude-multiple", title: "More than one claude command line is installed",
    means: "The native installer, npm and WinGet each install their own claude, and they do not know of each other.",
    does: ["V: this tool asked each one for --version in a throwaway config folder, and lists them with where each came from and which one a shell runs first (the first on PATH, in the order of PATHEXT).", "D: Claude Code's installation troubleshooting says to look for a second installation when claude still runs after an uninstall."],
    fix: ["Keep one: winget uninstall Anthropic.ClaudeCode, npm uninstall -g @anthropic-ai/claude-code, or delete %USERPROFILE%\\.local\\bin\\claude.exe."],
    issues: [],
  },
  {
    id: "claude-older-first", title: "The claude that runs first is older than another one",
    means: "PATH lists the folder of an older install before the folder of a newer one.",
    does: ["V: the versions are what `--version` printed for each file."],
    fix: ["Put the newer one's folder first, or remove the older install."],
    issues: [],
  },
  {
    id: "claude-no-version", title: "A claude on PATH does not print a version",
    means: "The file runs and does not say a version, or does not run.",
    does: ["V: the line says what happened: it could not start, did not answer in 30 seconds, or printed no version."],
    fix: ["Reinstall it, or take its folder off PATH."],
    issues: [],
  },
  {
    id: "node-for-npm", title: "Node is older than the npm package of Claude Code wants",
    means: "The npm package of Claude Code wants Node 22 or later.",
    does: ["V: the package metadata of 2.1.301 (npm view @anthropic-ai/claude-code engines) says node >=22.0.0, and its bin is a claude.exe.", "D: on an older Node npm prints an EBADENGINE warning; the install completes and claude still runs, because the program is a native binary that does not use your Node at run time."],
    fix: ["Nothing, if claude runs. For a clean install: Node 22 or later, or the native installer."],
    issues: [],
  },
  {
    id: "long-paths", title: "Long paths are not switched on",
    means: "Windows limits a path to 260 characters unless LongPathsEnabled is 1 in the registry and the program opts in; git has its own core.longpaths.",
    does: ["V: Claude Code's Write tool wrote a file at a path of more than 300 characters, 391 when it was tried (on a machine with LongPathsEnabled on).", "D: programs started through the shell (git, npm, compilers) fail on deep paths unless they opt in; git needs core.longpaths true.", "N: the case with LongPathsEnabled off was not tried: the tool never changes the registry of the machine it runs on."],
    fix: ["As an administrator: reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f.", "git config --global core.longpaths true."],
    issues: [],
  },
  {
    id: "autocrlf", title: "git converts line endings (core.autocrlf is true)",
    means: "With core.autocrlf true git checks files out with CRLF and commits them with LF. The default of Git for Windows' installer is true.",
    does: ["V: Claude Code's Write tool wrote a new file with LF only, and its Edit tool kept the CRLF of a file it changed: only the edited line differed.", "D: git warns \"LF will be replaced by CRLF\" when it adds the new file, and converts it when it checks it out again."],
    fix: ["Nothing is wrong. To stop the conversion in one repository: git config core.autocrlf false there, with a .gitattributes that names the endings you want."],
    issues: [ISSUE(2805, "Claude Code consistently creates files with Windows line endings on Linux systems (the opposite direction)")],
  },
  {
    id: "execution-policy", title: "The PowerShell execution policy blocks scripts",
    means: "A Restricted or AllSigned policy stops .ps1 files from running.",
    does: [
      "V: Claude Code starts PowerShell with -ExecutionPolicy Bypass at process scope: a hook with shell powershell and the PowerShell tool both saw `Process Bypass` in Get-ExecutionPolicy -List. With CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY=1 they saw `Process Undefined`, and the policy of the machine applies.",
      "D: a policy set by Group Policy (MachinePolicy or UserPolicy) wins over the process scope.",
      "N: a Group Policy policy was not tried (the tool does not change the machine).",
    ],
    fix: ["Remove CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY, or set a CurrentUser policy of RemoteSigned (Set-ExecutionPolicy -Scope CurrentUser RemoteSigned).", "A policy from Group Policy is for whoever manages the machine."],
    issues: [],
  },
  {
    id: "code-page", title: "The console code page is not UTF-8",
    means: "A Windows program run through the Bash tool prints in the console's code page (437, 850, 1252, 936...). Claude Code reads what a tool prints as UTF-8.",
    does: [
      "V: under code page 437, `cmd.exe /c dir /b` through the Bash tool printed caf?-?ber.txt for café-über.txt (replacement characters), while `ls` (a Git program that prints UTF-8) was right. The PowerShell tool set code page 65001 and printed it right, for the same command.",
      "N: starting from a terminal set to chcp 65001 was not tried as the fix.",
    ],
    fix: ["Run Windows programs through the PowerShell tool, or start Claude Code from a terminal set to UTF-8 (chcp 65001).", "Windows 11's \"Use Unicode UTF-8 for worldwide language support\" switch makes the system code page UTF-8; it is a system setting with side effects."],
    issues: [ISSUE(7134, "Claude Code does not respect file encoding, corrupts Windows-1252 files")],
  },
  {
    id: "index-lock", title: "A stale .git\\index.lock",
    means: "git creates .git\\index.lock while it changes the index and deletes it when it is done. One that is left behind makes every later git command in the repository fail. This tool only looks: the file exists and no git.exe process runs.",
    does: ["N: how Claude Code's Bash tool leaves it behind was not reproduced; the thread says a git command that the tool stopped did."],
    fix: ["Delete the file: del \".git\\index.lock\"."],
    issues: [ISSUE(28546, "Stale .git/index.lock left behind after Bash tool git commands on Windows")],
  },
  {
    id: "user-env-not-in-process", title: "A variable of the Windows user environment is not in this process",
    means: "A program reads the user environment (HKCU\\Environment) once, when it starts. A variable set afterwards (setx, System Properties, claude-windows-doctor fix) is not in a terminal, the desktop app or an editor that was already running. This is the finding of claude-relocate for CLAUDE_CONFIG_DIR.",
    does: ["D: Windows gives a program a copy of the user environment when the program starts (Microsoft's documentation of environment variables); a change made later reaches only the programs started after it.", "V: this tool reads HKCU\\Environment with reg query (the real one, read only) and compares the names that start with CLAUDE or ANTHROPIC with this process. Only names are shown, and values only for paths and switches: a token in ANTHROPIC_API_KEY is shown as set.", "N: when the desktop app, VS Code and JetBrains read their environment was not tried: this tool starts none of them."],
    fix: ["Open a new terminal; restart the desktop app or the editor."],
    issues: [],
  },
  {
    id: "user-env-differs", title: "A variable differs between the user environment and this process",
    means: "The registry says one thing, and this terminal has another (a set command, a profile, or an old value).",
    does: ["D: a program started from the Start menu or Explorer gets the user environment; a program started from a terminal gets the terminal's copy.", "V: this tool compares the two as text, with %NAME% in a REG_EXPAND_SZ value expanded. Values of variables that are not paths or switches are never printed."],
    fix: ["Set it in one place, the user environment, and open a new terminal."],
    issues: [],
  },
  {
    id: "process-env-not-in-user", title: "A setting exists in this process only",
    means: "CLAUDE_CONFIG_DIR, CLAUDE_CODE_GIT_BASH_PATH or CLAUDE_CODE_USE_POWERSHELL_TOOL is set in this terminal and nowhere else: other terminals, the desktop app and the editors do not have it.",
    does: ["D: a variable set in a terminal (set, $env:NAME=, export in a profile) is in that terminal and the programs it starts, and in no other.", "V: only these three names are reported, because they are the settings of this tool and of claude-relocate; the variables that Claude Code sets for the programs it starts (CLAUDECODE, CLAUDE_PROJECT_DIR and others) are left out."],
    fix: ["setx NAME value, or claude-windows-doctor fix --git-bash for the Git Bash path."],
    issues: [],
  },
  {
    id: "wsl-no-distro", title: "WSL has only the distributions of other tools",
    means: "docker-desktop, rancher-desktop and podman make a WSL distribution for themselves. Nobody works in it.",
    does: ["V: `wsl.exe -l -v` prints UTF-16 text in the language of Windows; this tool decodes it and reads the columns, and calls docker-desktop, docker-desktop-data, rancher-desktop, rancher-desktop-data and podman-machine-default the distributions of other tools.", "D: the bash.exe launcher in System32 and wsl.exe open the default distribution."],
    fix: ["wsl --install -d Ubuntu, if you want Claude Code in WSL. Nothing otherwise."],
    issues: [ISSUE(619, "Claude CLI Hangs or Becomes Unresponsive in WSL (Intermittent Issue)")],
  },
  {
    id: "wsl-windows-claude", title: "In WSL, claude is the Windows one",
    means: "Windows programs are on a WSL distribution's PATH (through /mnt/c). A claude that WSL finds there is the Windows Claude Code, run through interop.",
    does: ["N: this check runs only inside WSL, which CI does not have; the logic is held to a pretend WSL machine in the tests, not to a real distribution."],
    fix: ["Install Claude Code in the distribution (curl -fsSL https://claude.ai/install.sh | bash) and put ~/.local/bin before the /mnt/c folders on PATH."],
    issues: [ISSUE(21875, "Repeated Bun v1.3.5 segfaults -- 78 crashes, root cause identified (Windows + WSL)")],
  },
  {
    id: "wsl-config-on-mnt", title: "In WSL, the config folder or the project is on a Windows drive",
    means: "/mnt/c is a bridge to Windows' file system and is slow for many small files.",
    does: ["D: Microsoft's WSL documentation advises against working across the file systems.", "N: not timed here."],
    fix: ["Use ~/.claude and keep projects in the Linux home."],
    issues: [],
  },
  {
    id: "wsl-inherits-windows", title: "WSL reads the Windows managed settings",
    means: "wslInheritsWindowsSettings is a managed setting. When it is true in the Windows registry (HKLM) or in C:\\Program Files\\ClaudeCode, Claude Code in WSL reads managed settings from the Windows policy chain.",
    does: ["D: /etc/claude-code is read only when no Windows admin document is present; the key has no effect on native Windows; it needs Claude Code 2.1.282 or later.", "N: not put to the binary: it needs an administrator to write the policy, and this tool never changes the registry or C:\\Program Files of the machine it runs on."],
    fix: ["Nothing, unless a WSL session follows the Windows policy and you did not expect it."],
    issues: [],
  },
];

export const IDS = PAGES.map((p) => p.id);
const MARK = { V: "verified", D: "documented", N: "not verified" };

/** Every page id and title, in page order. */
export function listPages() {
  return PAGES.map(({ id, title }) => ({ id, title }));
}

/** A page by exact id or a unique part of one, with each line of `does` split into its mark and text, or null. */
export function pageFor(id) {
  const key = String(id).trim().toLowerCase();
  const exact = PAGES.find((x) => x.id === key);
  const partial = exact ? [] : PAGES.filter((x) => key && x.id.includes(key));
  const p = exact ?? (partial.length === 1 ? partial[0] : null);
  if (!p) return null;
  return { ...p, does: p.does.map((line) => { const m = /^([VDN]): (.*)$/s.exec(line); return m ? { source: MARK[m[1]], text: m[2] } : { source: null, text: line }; }) };
}

/** The ids nearest to a word that is not one, for "did you mean". */
export function nearIds(word) {
  const w = String(word).toLowerCase();
  const scored = IDS.map((id) => ({ id, score: id.includes(w) || w.includes(id) ? 0 : w.split("-").filter((p) => p && id.includes(p)).length ? 1 : 2 })).filter((x) => x.score < 2);
  return scored.sort((a, b) => a.score - b.score).slice(0, 5).map((x) => x.id);
}
