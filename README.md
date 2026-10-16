# claude-windows-doctor

[![test](https://github.com/nrzz/claude-windows-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/claude-windows-doctor/actions/workflows/test.yml) [![e2e](https://github.com/nrzz/claude-windows-doctor/actions/workflows/e2e.yml/badge.svg)](https://github.com/nrzz/claude-windows-doctor/actions/workflows/e2e.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg) [![part of the Claude Code toolkit](https://img.shields.io/badge/Claude%20Code-toolkit-d97757.svg)](https://github.com/nrzz/claude-code-toolkit)

Windows is where Claude Code's issue tracker has the most setup trouble. On 16 October 2026, anthropics/claude-code had 884 open issues with "windows" in the title, 476 of them outside the desktop and Cowork labels, and 173 naming Git Bash, PowerShell or WSL. Several are the same question: which shell does the Bash tool get? Claude Code looks for Git Bash in three places only, so a Git for Windows that is anywhere else is not found, the model gets the PowerShell tool instead, and nothing says why ([#8674](https://github.com/anthropics/claude-code/issues/8674), [#13184](https://github.com/anthropics/claude-code/issues/13184)). `CLAUDE_CODE_GIT_BASH_PATH` is ignored when it holds quote marks, a `%USERPROFILE%`, a relative path or a file that is not there, and in a project settings file it is not read at all. `defaultShell` does not change the model's tools, and [#7490](https://github.com/anthropics/claude-code/issues/7490), which asks to choose the shell that the Bash tool uses, has 148 reactions. The rest are setup problems that nobody sees from inside a session: which of two or three installed `claude` commands a terminal runs, the PowerShell execution policy, the console code page, long paths, a stale `.git\index.lock` ([#28546](https://github.com/anthropics/claude-code/issues/28546)), a variable that is in the registry and not in the terminal.

claude-windows-doctor says which shell tools Claude Code gives the model on your machine and why (the three places it looked for Git Bash, in order), lists every `claude` on the machine with its version and which one a terminal runs, and finds the setup problems behind those threads, each with its fix; `check --live` proves the answer with the real `claude` through a fake API on 127.0.0.1. `fix --git-bash` sets `CLAUDE_CODE_GIT_BASH_PATH` for a Git Bash that Claude Code does not find, with a record and an `undo`, and the tool is a plain Node program that runs outside Claude, so it costs no tokens.

## What you get

- `check`: on Windows, the shell tools Claude Code gives the model (the Bash tool when it finds Git Bash, the PowerShell tool and the edition of PowerShell it runs) and why: the three places Claude Code looks for Git Bash in its order and what each answered, and what `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_USE_POWERSHELL_TOOL`, the deny rules and `defaultShell` do and do not change. Every `claude` on PATH and in the places the installers use (the native installer's `.local\bin`, npm's global folder, WinGet, the desktop app's bundles, an editor's extension), each with its version, where it came from and which one a terminal runs first. Node and npm; long paths (the registry switch and git's `core.longpaths`); git's `core.autocrlf`; the PowerShell execution policy; the console code page; a stale `.git\index.lock`; the `CLAUDE_*` and `ANTHROPIC_*` variables of the user environment against this process; WSL. Inside a WSL distribution it checks the WSL side. On Linux and macOS it says there is nothing to check and exits 0.
- `check --live`: proves the answer with the real `claude`. It starts the binary (the first `claude` on PATH, or the one `--claude` names) against a fake Messages API on 127.0.0.1 in a throwaway folder, reads the tools of its first request and the `bash.exe` it says it took, and compares them with the prediction. No token is spent.
- `fix --git-bash` and `undo`: when Git Bash exists and Claude Code does not find it, `fix` sets `CLAUDE_CODE_GIT_BASH_PATH` in the Windows user environment and keeps a record of what was there; `undo` puts that back. Both take `--dry-run`, and both refuse off Windows.
- `explain <finding-id>`: what a finding means, what Claude Code does in that case (each line marked verified, documented or not verified), the fix, and the issue threads.
- `--json` on every command, for scripts and for other tools.
- `/windows-doctor:check`, a plugin skill that hands Claude the short form of the report (`check --markdown`).

## What it costs in tokens

| Part | Tokens | |
| --- | --- | --- |
| The tool: every command, `--json`, `--markdown` | 0 | It reads files and the registry and starts a few Windows programs. `check --live` starts the real `claude` against a fake API on 127.0.0.1: nothing reaches Anthropic, and no token is spent. |
| The skill in the model's request | 0 | `/windows-doctor:check` is user-only (`disable-model-invocation: true`) and its description is `Check the Windows setup.`: 24 characters, about 6 tokens by characters / 4. With the plugin loaded, the request for a plain prompt had the same size as without it, the same tool list and no occurrence of `windows-doctor`: 75,124 characters on 2.1.299 and 74,594 on 2.1.295, with and without the plugin. `claude plugin details` projects `Always-on: ~11 tok` for the skill, and the capture does not bear that out. |
| `/windows-doctor:check` | about 538 tokens once; about 1,567 at the cap | The model receives the report and a 270-character instruction that asks for a reply of at most 10 lines. For a project with 4 findings on Windows, with the paths of a temporary folder, that was 2,046 characters in the skill block and 107 in the command block: 2,153 in all, about 538 tokens by characters / 4. The report holds at most 12 findings, at most 500 characters to a line and at most 16 lines. A report at the cap (15 warnings, 14 of them about variables of the user environment with values of about 280 characters) was 6,161 characters in the skill block and 107 in the command block: 6,268 in all, about 1,567 tokens. These are characters divided by 4, an estimate, and not a count by Claude's tokenizer. The figures were the same on 2.1.295 and 2.1.299. |

## Install

**From a terminal**, with Node 18 or newer. There is nothing to install and no dependency:

```bash
npx -y github:nrzz/claude-windows-doctor check --project .
```

```bash
npx -y github:nrzz/claude-windows-doctor explain git-bash-not-found
```

Or from a clone:

```bash
git clone https://github.com/nrzz/claude-windows-doctor
node claude-windows-doctor/bin/claude-windows-doctor.mjs check --project .
```

**As a Claude Code plugin**, in Claude Code:

```text
/plugin marketplace add nrzz/claude-code-toolkit
/plugin install windows-doctor@claude-code-toolkit
```

Then type `/windows-doctor:check`. It runs `check --markdown` for the current project and asks Claude to answer in at most 10 lines: the shell the Bash tool gets and why in one line, then each problem with its fix. It also asks Claude to edit nothing until you agree. To try the plugin from a clone before it is in the marketplace: `claude --plugin-dir ./claude-windows-doctor`.

## Use

The examples are real runs on Windows 11 in a throwaway folder: an empty Claude config folder, no settings file, and a file that stands in for `HKCU\Environment` (the tool uses a file when `CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE` names one, as the tests do). The user name and the project folder are shortened to `me` and `shop`. The two `--dry-run` examples read the real `HKCU\Environment` of this machine and write nothing. Git for Windows is at `E:\Das\Git`, not under `C:\Program Files`, which is the case that the issue threads describe.

```text
Usage: claude-windows-doctor <command> [options]

Read (they change nothing):
  check    [--live] [--claude <path>] [--project <dir>] [--markdown]
           on Windows: the shell tools Claude Code gives the model (the Bash tool when it finds Git
           Bash, the PowerShell tool) and why, in the order Claude Code looks; every claude on PATH
           and in the places the installers use, with its version and which one runs first; Node and
           npm; long paths; git core.autocrlf; the PowerShell execution policy; the console code
           page; a stale .git\index.lock; the CLAUDE_* and ANTHROPIC_* variables of the user
           environment against this process; WSL. Inside a WSL distribution: the WSL side. On Linux
           and macOS: nothing to check. Exit 1 on an error or a warning. --live proves the shell
           choice with the real claude through a fake API on 127.0.0.1 (no token is spent), using
           the first claude on PATH or --claude. --markdown is the short report the
           /windows-doctor:check skill hands to Claude (at most 12 findings); it always exits 0,
           because Claude Code drops a skill whose command fails
  explain  <finding-id>
           what a finding means, what Claude Code does in that case (each line marked verified,
           documented or not verified), the fix, and the issue threads

Change (Windows only; they set and remove one value of the user environment, and take --dry-run):
  fix      --git-bash [--path <bash.exe>] [--dry-run]
           when Git Bash exists and Claude Code does not find it, set CLAUDE_CODE_GIT_BASH_PATH in
           the Windows user environment (HKCU\Environment), and record what was there before in
           <config folder>\windows-doctor\record.json. Without --path the Git Bash found on this
           machine is used; with --path that file (or a Git for Windows folder) is set
  undo     [--dry-run]
           put back what fix recorded: the old value with its old type, or no value at all, and
           delete the record

Options for every command:
  --project <dir>   the folder Claude Code starts in (default: the folder you are in)
  --json            one JSON document on stdout
  -h, --help        this text
  -v, --version     the version

Exit codes: 0 ok; 1 findings, a refusal (fix and undo off Windows) or a failed proof; 2 a usage error or an unexpected error.
Environment: CLAUDE_CONFIG_DIR (Claude's config folder), CLAUDE_WINDOWS_DOCTOR_MANAGED_DIR (the folder to read
managed-settings.json from, instead of C:\Program Files\ClaudeCode; the tests use it) and
CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE (a JSON file that stands in for HKCU\Environment; the tests use it).
It reads files, the registry and the output of a few Windows programs, and starts claude --version and
(with --live) claude -p in throwaway folders. It writes only with fix and undo, and it sends nothing to
Anthropic or anyone else.
```

### `check`

Reads, and starts a few programs that only read. `--project <dir>` is the folder Claude Code starts in (the default is the folder you are in): it decides which project and local settings files are read and where `.git\index.lock` is looked for. Exit 0 when there is no error and no warning, 1 otherwise (a note does not count), 2 for a usage error. On Linux and macOS it prints `Nothing to check on Linux: claude-windows-doctor checks the setup of Claude Code on Windows, and from inside a WSL distribution the WSL side. Run it on Windows, or in WSL.` (or `macOS`) and exits 0. On this machine the first `git.exe` on PATH is in `mingw64\bin`, which is how a terminal started from Git Bash has it, and Git for Windows is not under `C:\Program Files`: Claude Code does not find Git Bash, the model gets the PowerShell tool only, and the report says so and why.

```text
$ claude-windows-doctor check
claude-windows-doctor 1.0.0  the Windows setup of Claude Code
project   C:\Users\me\shop
system    Windows 11 Home Single Language (10.0.26300), x64; Node 24.19.0, npm 11.17.0

The shell the model gets
  Bash tool         no: Git Bash was not found
  PowerShell tool   yes (Git Bash was not found, so Claude Code turns the PowerShell tool on), Windows PowerShell 5.1 (powershell.exe)
  how Claude Code looked for Git Bash, in its order:
    1  CLAUDE_CODE_GIT_BASH_PATH: not set
    2  C:\Program Files\Git\bin\bash.exe: not there
       C:\Program Files (x86)\Git\bin\bash.exe: not there
    3  where git: E:\Das\Git\mingw64\bin\git.exe is the first line (of 2); two folders up, E:\Das\Git\mingw64\bin\bash.exe: not there
  Git Bash files on this machine: E:\Das\Git\bin\bash.exe
  defaultShell      not set: the shell for the commands you type after !, not the model's tool

claude on this machine
  1  C:\Users\me\AppData\Local\AnthropicClaude\claude.exe
      not run    the Claude desktop app's launcher (not the CLI); not on PATH
  2  C:\Users\me\AppData\Roaming\Claude\claude-code\2.1.295\d2e29494ec83\claude.exe
      2.1.295    bundled by the Claude desktop app; not on PATH
  3  C:\Users\me\AppData\Roaming\Claude\claude-code\2.1.299\f0584be0fbaf\claude.exe
      2.1.299    bundled by the Claude desktop app; not on PATH
  none of them is on PATH, so a terminal does not know the command claude

The rest of the setup
  long paths        Windows LongPathsEnabled on; git core.longpaths not set
  line endings      git core.autocrlf true (E:/Das/Git/etc/gitconfig)
  PowerShell policy MachinePolicy Undefined, UserPolicy Undefined, Process Undefined, CurrentUser RemoteSigned, LocalMachine Undefined; Claude Code's PowerShell gets Process Bypass (it passes -ExecutionPolicy Bypass)
  console           code page 437, system OEM 437, ANSI 1252
  .git\index.lock   no git repository here

User environment (HKCU\Environment) against this process
  CLAUDE_CONFIG_DIR                  user: C:\Users\me\.claude  this process: C:\Users\me\.claude
  (2 that Claude Code or this tool sets for its own programs are left out)

WSL
  * docker-desktop     Running    WSL 2  (made by another tool, not one to work in)

Settings files read: none exist

Findings
  warning git-bash-not-found
      Git for Windows is installed (E:\Das\Git\bin\bash.exe), but Claude Code does not find it: where git prints E:\Das\Git\mingw64\bin\git.exe first, and two folders up from it bin\bash.exe would be E:\Das\Git\mingw64\bin\bash.exe, which is not there.
      what Claude Code does: The Bash tool is not offered; the model gets the PowerShell tool only. Claude Code looks at CLAUDE_CODE_GIT_BASH_PATH, then C:\Program Files\Git and C:\Program Files (x86)\Git, then the first git.exe that where.exe lists.
      fix: claude-windows-doctor fix --git-bash sets CLAUDE_CODE_GIT_BASH_PATH=E:\Das\Git\bin\bash.exe in the user environment (undo with claude-windows-doctor undo); or put the Git cmd folder before mingw64\bin on PATH.
      more: claude-windows-doctor explain git-bash-not-found
  note    powershell-5
      The PowerShell tool will run Windows PowerShell 5.1: no pwsh (PowerShell 7) was found.
      what Claude Code does: The tool's own description tells the model that && and || are not available there, and that > and Out-File write the system code page unless told otherwise.
      fix: Install PowerShell 7 (winget install Microsoft.PowerShell): Claude Code uses pwsh when it finds it.
      more: claude-windows-doctor explain powershell-5
  note    wsl-bash-on-path
      bash.exe on PATH is the WSL launcher (C:\Windows\System32\bash.exe), not a Git Bash.
      what Claude Code does: Claude Code does not use it: with no variable and no git it offered the PowerShell tool only.
      fix: Install Git for Windows for a Bash tool, or leave it: the PowerShell tool does the work.
      more: claude-windows-doctor explain wsl-bash-on-path
  note    long-paths
      Paths longer than 260 characters: git's core.longpaths is not set.
      what Claude Code does: From Windows' and git's documentation: a program that does not ask for long paths (git, npm, a compiler run through the shell) fails on a deep node_modules or build folder. Claude Code's own file tools wrote a file at a path of more than 300 characters (put to the binary; LongPathsEnabled was on).
      fix: git config --global core.longpaths true.
      more: claude-windows-doctor explain long-paths
  note    autocrlf
      git's core.autocrlf is true (E:/Das/Git/etc/gitconfig).
      what Claude Code does: Claude Code's Write tool wrote a new file with LF only and its Edit tool kept the CRLF of a file it changed (put to the binary). git converts line endings when it adds and checks out files, and warns "LF will be replaced by CRLF".
      fix: Nothing is wrong. To stop the conversion in a repository, set core.autocrlf false there and a .gitattributes with the endings you want.
      more: claude-windows-doctor explain autocrlf
  note    wsl-no-distro
      WSL has only distributions that other tools made for themselves (docker-desktop; the default is docker-desktop): there is no Linux distribution to run Claude Code in.
      what Claude Code does: The bash.exe launcher in System32 and wsl.exe open the default distribution, which is not one to work in.
      fix: wsl --install -d Ubuntu, if you want Claude Code in WSL. Nothing is needed otherwise.
      more: claude-windows-doctor explain wsl-no-distro

0 errors, 1 warning, 5 notes
```

The exit code of that run was 1: one warning. With `CLAUDE_CODE_GIT_BASH_PATH=E:/Das/Git/bin/bash.exe` in the environment the first part reads:

```text
$ claude-windows-doctor check
claude-windows-doctor 1.0.0  the Windows setup of Claude Code
project   C:\Users\me\shop
system    Windows 11 Home Single Language (10.0.26300), x64; Node 24.19.0, npm 11.17.0

The shell the model gets
  Bash tool         yes: Git Bash at E:/Das/Git/bin/bash.exe (from CLAUDE_CODE_GIT_BASH_PATH, the process environment)
  PowerShell tool   decided by your account: Claude Code's documentation says on for claude.ai and Console accounts, off in Bedrock, Vertex and Foundry sessions, Windows PowerShell 5.1 (powershell.exe)
  how Claude Code looked for Git Bash, in its order:
    1  CLAUDE_CODE_GIT_BASH_PATH: E:/Das/Git/bin/bash.exe (the process environment): used
  Git Bash files on this machine: E:\Das\Git\bin\bash.exe
  defaultShell      not set: the shell for the commands you type after !, not the model's tool
  Git Bash starts   yes
```

(The tool starts the Git Bash that Claude Code would take with `-c "exit 0"`, to say whether it starts. When the variable is set, the PowerShell tool is decided by the account: Claude Code's documentation says on for claude.ai and Console accounts, and off for Bedrock, Vertex and Foundry. The real binary behind a fake API has no account, so there it was off; `check` says so instead of guessing.)

`--markdown` is the short report that the skill hands to Claude: a header, the system, the shell in one line, and the errors and warnings, one line each with the fix, at most 12 of them. It always exits 0, because Claude Code drops a skill whose command fails (put to the binary: a command that exits 1 never reached the model, and one that exits 0 did).

```text
$ claude-windows-doctor check --markdown
## windows-doctor check: C:\Users\me\shop
Windows 11 Home Single Language; no claude on PATH.
Shell: Bash tool no, Git Bash not found; PowerShell tool yes. 0 errors, 1 warning, 5 notes.
- WARNING `git-bash-not-found`: Git for Windows is installed (E:\Das\Git\bin\bash.exe), but Claude Code does not find it: where git prints E:\Das\Git\mingw64\bin\git.exe first, and two folders up from it bin\bash.exe would be E:\Das\Git\mingw64\bin\bash.exe, which is not there. Fix: claude-windows-doctor fix --git-bash sets CLAUDE_CODE_GIT_BASH_PATH=E:\Das\Git\bin\bash.exe in the user environment (undo with claude-windows-doctor undo); or put the Git cmd folder before mingw64\bin on PATH.
```

The findings, by id (`explain <id>` has a page for each):

| Id | Severity | What it says |
| --- | --- | --- |
| `no-shell-tool` | error | Claude Code will not start: no Git Bash and the PowerShell tool is off |
| `git-bash-not-found` | warning | Git for Windows is installed, but Claude Code does not find its bash.exe |
| `git-bash-path-ignored` | warning | CLAUDE_CODE_GIT_BASH_PATH is set, and Claude Code ignores it |
| `git-bash-path-project-settings` | warning | CLAUDE_CODE_GIT_BASH_PATH is in a project or local settings file, where it is not used |
| `git-bash-broken` | warning | Git Bash is found, and does not start |
| `powershell-variable-unread` | warning | CLAUDE_CODE_USE_POWERSHELL_TOOL is set to a value Claude Code does not read |
| `default-shell-scope` | note | defaultShell is not the shell the model gets |
| `powershell-5` | note | The PowerShell tool runs Windows PowerShell 5.1 |
| `wsl-bash-on-path` | note | bash.exe on PATH is the WSL launcher |
| `claude-launcher-first` | warning | The first claude on PATH is not the command line |
| `claude-not-on-path` | warning | claude is installed and its folder is not on PATH |
| `claude-multiple` | warning | More than one claude command line is installed |
| `claude-older-first` | warning | The claude that runs first is older than another one |
| `claude-no-version` | warning | A claude on PATH does not print a version |
| `node-for-npm` | note | Node is older than the npm package of Claude Code wants |
| `long-paths` | note | Long paths are not switched on |
| `autocrlf` | note | git converts line endings (core.autocrlf is true) |
| `execution-policy` | warning | The PowerShell execution policy blocks scripts |
| `code-page` | note | The console code page is not UTF-8 |
| `index-lock` | warning | A stale .git\index.lock |
| `user-env-not-in-process` | warning | A variable of the Windows user environment is not in this process |
| `user-env-differs` | warning | A variable differs between the user environment and this process |
| `process-env-not-in-user` | note | A setting exists in this process only |
| `wsl-no-distro` | note | WSL has only the distributions of other tools |
| `wsl-windows-claude` | warning | In WSL, claude is the Windows one |
| `wsl-config-on-mnt` | warning | In WSL, the config folder or the project is on a Windows drive |
| `wsl-inherits-windows` | note | WSL reads the Windows managed settings |

### `check --live`

Adds the proof. It starts the real `claude` (the first on PATH, or `--claude <path>`) with `-p` against a fake Messages API on 127.0.0.1, in a throwaway home, config folder and project folder, with every `CLAUDE_*`, `ANTHROPIC_*` and `CLAUDECODE*` variable of your machine taken out of its environment and with updates and telemetry off. From your setup it copies the environment (PATH and the rest), the two shell variables as this process has them, and from your settings files only the `env` entries of those two variables and the deny rules that take a whole shell tool away: no hook and no other setting is copied, so nothing of yours runs. It reads the tools of the first request and the `bash.exe` named in the binary's debug log, and says `proved` when they are what the prediction said. Exit 1 when they differ or the binary could not be run. `--markdown` and `--live` do not go together, and `--live` outside Windows is refused.

```text
$ claude-windows-doctor check --live --claude C:/Users/me/AppData/Roaming/Claude/claude-code/2.1.299/f0584be0fbaf/claude.exe
claude-windows-doctor 1.0.0  the Windows setup of Claude Code
project   C:\Users\me\shop
system    Windows 11 Home Single Language (10.0.26300), x64; Node 24.19.0, npm 11.17.0

The shell the model gets
  Bash tool         no: Git Bash was not found
  PowerShell tool   yes (Git Bash was not found, so Claude Code turns the PowerShell tool on), Windows PowerShell 5.1 (powershell.exe)
  how Claude Code looked for Git Bash, in its order:
    1  CLAUDE_CODE_GIT_BASH_PATH: not set
    2  C:\Program Files\Git\bin\bash.exe: not there
       C:\Program Files (x86)\Git\bin\bash.exe: not there
    3  where git: E:\Das\Git\mingw64\bin\git.exe is the first line (of 2); two folders up, E:\Das\Git\mingw64\bin\bash.exe: not there
  Git Bash files on this machine: E:\Das\Git\bin\bash.exe
  defaultShell      not set: the shell for the commands you type after !, not the model's tool
  live              proved with the real claude 2.1.299 (C:/Users/me/AppData/Roaming/Claude/claude-code/2.1.299/f0584be0fbaf/claude.exe), through a fake API on 127.0.0.1 (no token spent):
                    the first request listed PowerShell; PowerShell edition: Windows PowerShell 5.1 (powershell.exe)
                    the fake API has no account, so the account's default for the PowerShell tool is off there; predicted: PowerShell
```

### `fix`

`fix` takes one thing to fix, `--git-bash`: it sets `CLAUDE_CODE_GIT_BASH_PATH` in the Windows user environment (`HKCU\Environment`), so that every program started afterwards has it: a terminal from the Start menu, Windows Terminal, VS Code, the desktop app. It records what was there before, so that `undo` can put it back. Which file it points at: the one `--path` names (a `bash.exe`, or a Git for Windows folder); else the Git Bash that already works in this process; else the first Git Bash found (a `git.exe` on PATH, the place Git for Windows records its install in the registry, the usual folders). It does nothing when Claude Code finds Git Bash by itself, and it says so; and it refuses when the variable is set in the user or managed settings and is wrong there, because a value in the user environment would not change what Claude Code reads. After a change: open a new terminal, and restart the desktop app or the editor that was already running, because a program reads the user environment once, when it starts.

```text
$ claude-windows-doctor fix --git-bash --dry-run
Would set CLAUDE_CODE_GIT_BASH_PATH=E:\Das\Git\bin\bash.exe in the Windows user environment (HKCU\Environment). Found by: git.exe on PATH (E:\Das\Git\mingw64\bin\git.exe).
Nothing was changed (--dry-run).
```

With `--json` the same dry run reads (the `record` is where the record would be written):

```json
{
  "ok": true,
  "refused": null,
  "reason": null,
  "dryRun": true,
  "action": "set",
  "name": "CLAUDE_CODE_GIT_BASH_PATH",
  "key": "HKCU\\Environment",
  "layer": "registry",
  "value": "E:\\Das\\Git\\bin\\bash.exe",
  "previous": null,
  "via": "git.exe on PATH (E:\\Das\\Git\\mingw64\\bin\\git.exe)",
  "record": "C:\\Users\\me\\.claude\\windows-doctor\\record.json",
  "notes": [
    "Nothing was changed (--dry-run)."
  ]
}
```

Off Windows: `refused: fix --git-bash works on Windows only: it changes a variable of the Windows user environment.` and exit 1. `fix` writes the registry with `reg add` and nothing else; it never changes `PATH`, the machine-wide environment, git's configuration or the execution policy.

### `undo`

Puts back what `fix` recorded: the old value with its old registry type, or no value at all, and deletes the record. If the value was changed after `fix` (by you, or by another tool), it is left as it is and the record is deleted. A record that was not written by this tool is refused, and left in place.

```text
$ claude-windows-doctor undo --dry-run
No record of a fix was found (looked at C:\Users\me\.claude\windows-doctor\record.json). There is nothing to undo.
```

### `explain`

`explain <finding-id>` prints the page of a finding. Each line under "What Claude Code does" is marked: *verified* (seen in a real run, of the binary or of the Windows program the line names), *documented* (from Claude Code's, Windows' or git's documentation) or *not verified*. Exit 1 for an id that is not one, with the nearest ids.

```text
$ claude-windows-doctor explain git-bash-not-found
git-bash-not-found   Git for Windows is installed, but Claude Code does not find its bash.exe

Claude Code gives the model a Bash tool only when it finds Git Bash. It does not search the disk: it looks in three places, in this order, and the first hit wins. This machine has a Git for Windows that none of the three leads to.

What Claude Code does
  - (verified) 1. CLAUDE_CODE_GIT_BASH_PATH, when it names an existing file called bash.exe, sh.exe, bash or sh. 2. C:\Program Files\Git\bin\bash.exe, then C:\Program Files (x86)\Git\bin\bash.exe, written out (the ProgramFiles variable is not read). 3. The first line that `where.exe git` prints that exists, is not in the working folder and ends in .com, .exe, .bat or .cmd: two folders up from that file, bin\bash.exe.
  - (verified) step 3 works for ...\Git\cmd\git.exe (the folder Git for Windows puts on PATH) and fails for ...\Git\mingw64\bin\git.exe, which is two folders up from mingw64, not from the Git folder. Only the first line counts: with mingw64\bin before cmd on PATH, Git Bash is not found, with cmd first it is. Git Bash itself starts with mingw64\bin first, so a Claude Code started from Git Bash on a Git that is not under C:\Program Files does not find it.
  - (verified) with no Git Bash the model gets the PowerShell tool only (the default when Git Bash is not found), and the debug log says "Git Bash not found; BashTool will be unavailable".
  - (verified) a bash.exe in C:\Windows\System32 (the WSL launcher) on PATH is not used.

The fix
  - claude-windows-doctor fix --git-bash sets CLAUDE_CODE_GIT_BASH_PATH in the user environment, with a record; claude-windows-doctor undo removes it.
  - Or set CLAUDE_CODE_GIT_BASH_PATH yourself (setx CLAUDE_CODE_GIT_BASH_PATH "E:\Das\Git\bin\bash.exe"), or put the Git cmd folder before mingw64\bin on PATH.
  - Programs that were already running do not see a changed environment: open a new terminal, and restart the desktop app or the editor.

The issue threads
  #8674  Claude Code VS Code Extension Fails to Detect Git Bash on Windows Despite Correct Configuration (closed, 68 comments)
        https://github.com/anthropics/claude-code/issues/8674
  #13184  `requires git-bash` error persists on Windows even when CLAUDE_CODE_GIT_BASH_PATH and symlink are set (closed)
        https://github.com/anthropics/claude-code/issues/13184
```

### The JSON documents

`--json` prints one document. Optional fields are marked `?`; `//` starts a comment.

```text
check      { ok, applicable, platform, kind, project, system, shell, binaries, settings, machine, userEnv, wsl, live?, findings, counts }    // Windows
             system      { os, release, arch }
             shell       { tools { Bash, PowerShell }, fatal, gitBash, powershell, deny { Bash [ { rule, scope, display } ], PowerShell [] }, defaultShell [ { scope, display, value, valid } ], why [] }    // deny holds the whole-tool rules
             gitBash     { found, path, how, variable { value, source, ignored [ { scope, file, value } ] }, variableState, trail [ { step, state, value, source, hint, path, exists, lines, skipped [ { line, reason } ], chosen, derived } ], starts { checked, ok, error }, onMachine [ { path, via } ] }
             powershell  { setting, state, why, unread, variable, edition, path, how }
             binaries    { first, entries [ { path, origin, onPath, runsFirst, version, note, skipped } ] }
             settings    { configDir, configSource, files [ { scope, label, display, path, exists, usable, error, applied } ], managedApplied }
             machine     { node { node, nodePath, npm, npmPrefix, npmFound }, longPaths { ok, enabled, set }, git { ok, version, autocrlf { origin, value }, longpaths, error }, executionPolicy { ok, list [ { scope, policy } ], respect, effective { scope, policy, bypassed, underneath }, machine }, codePage { ok, active, oem, ansi, error }, indexLock { ok, gitDir, lock } }
             userEnv     { ok, layer, error, entries [ { name, status, user { value?, set?, type? }, process { value?, set? } } ], own }    // status is same, differs, user-only or process-only; value is there for a path or a switch, and set: true for anything else
             wsl         { available, distros [ { name, isDefault, state, version, internal } ], defaultName, workable [], error }
             live        { ok, claude { path, version }, proved, predicted { tools, exit, bash, how }, actual { tools, exit, bash }, differences [], edition, warning, exitCode, requests }    // or { ok, error, claude }
             findings    [ { id, severity, message, effect, fix } ]
             counts      { error, warning, note }
check      { ok, applicable, platform, kind, system, message, findings, counts }    // Linux and macOS: nothing to check
check      { ok, applicable, platform, kind, project, system { os, release, arch, wsl }, binaries, locations { configDir, configSource, configOnWindows, project, projectOnWindows }, wslInherits, findings, counts }    // inside WSL
fix        { ok, refused, reason, dryRun, action, name, key, layer, value, previous { value, type }, via, record, notes [] }    // previous is null when nothing was there; action is set or nothing, and null when refused
undo       { ok, refused, reason, dryRun, action, name, key, layer, value, previous { value?, type? }, via, record, notes [] }    // action is restore, remove, forget or nothing
explain    { ok, id, title, means, does [ { source, text } ], fix [], issues [ { number, title, url } ] }
error      { ok, error }    // a usage error with --json: exit 2
error      { ok, refused, ids, near }    // explain with an id that is not one: exit 1
```

## How it works

It reads, on your machine only, the places below, and starts the programs below. What it says about Claude Code is what "What was verified" names; where an explain line says *documented*, it comes from a documentation page and the binary was not put to it.

- **The environment of the process**: `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_USE_POWERSHELL_TOOL`, `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY`, `CLAUDE_CONFIG_DIR`, `PATH` and `PATHEXT`, `ProgramW6432`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`.
- **The settings files**, highest first, only for the keys that bear on the shell: managed settings (the value `Settings` under `HKLM\SOFTWARE\Policies\ClaudeCode`, else `C:\Program Files\ClaudeCode\managed-settings.json` with its `managed-settings.d` folder, else the same value under `HKCU`; the first source that holds a policy key applies), `<project>\.claude\settings.local.json`, `<project>\.claude\settings.json`, and `settings.json` in the config folder (`%CLAUDE_CONFIG_DIR%`, else `%USERPROFILE%\.claude`). From them: the `env` block, `defaultShell`, the `permissions.deny` rules, and `wslInheritsWindowsSettings`. A file that is not strict JSON (a comment or a trailing comma is enough) is ignored by Claude Code, and is listed here as ignored.
- **The registry**: the values of `HKCU\Environment`; `LongPathsEnabled` under `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`; `ACP` and `OEMCP` under `HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`; the `InstallPath` that Git for Windows records.
- **Programs it starts**, all of which only read: `where.exe`, `reg.exe query`, `git --version` and `git config --show-origin --get-all`, PowerShell with `-NoProfile -NonInteractive` and `Get-ExecutionPolicy -List` (the PowerShell Claude Code would use, else Windows PowerShell), `cmd.exe /c chcp`, `tasklist` (only when an `index.lock` exists), `wsl.exe -l -v`, `npm --version` and `npm config get prefix`, the Git Bash Claude Code would take with `-c "exit 0"`, and `--version` of each `claude` it finds, in a throwaway home and config folder with no `CLAUDE_*` or `ANTHROPIC_*` variable. It never runs the desktop app's own launcher or a Microsoft Store alias. PowerShell and npm may leave a startup cache of their own under your `AppData` folder; the tool itself leaves nothing there.
- **Files**: the folders on PATH, the usual places of `claude` (`%USERPROFILE%\.local\bin`, `%APPDATA%\npm`, `%LOCALAPPDATA%\Microsoft\WinGet\Links`, the desktop app's `claude-code` folders, an editor's extension folders), the usual folders of Git for Windows, scoop and Chocolatey, the project's `.git\index.lock`.
- **On Linux and macOS** it reads nothing and says there is nothing to check. **Inside a WSL distribution** (`/proc/version` names Microsoft) it reads PATH, the settings files of the Linux side, `/mnt/c/Program Files/ClaudeCode/managed-settings.json` for `wslInheritsWindowsSettings`, and asks each `claude` it finds for its version.

**Which tools the model gets** (Claude Code 2.1.295 and 2.1.299, put to the binary in 129 cases):

- The **Bash tool** is there when Claude Code finds Git Bash, by the search below. Otherwise there is none.
- The **PowerShell tool**: `CLAUDE_CODE_USE_POWERSHELL_TOOL` decides when it is set. `1`, `true`, `yes` and `on` turn it on; `0`, `false`, `no` and `off` turn it off; any case, with spaces or a tab around; anything else (an empty value, `2`, `enabled`, `y`, `1.0`, `yes please`) reads as not set. The variable counts from the process environment and from the `env` of the user, project and local settings, the nearest file winning and the settings winning over the process environment; a number or a boolean written in `env` reaches Claude Code as text. When it is not set, the tool is on if Git Bash was not found, and otherwise it is decided by the account (documented: on for claude.ai and Console accounts, off in Bedrock, Vertex and Foundry sessions), which a fake API cannot answer: there the tool was off.
- With **no Git Bash and the PowerShell tool off**, Claude Code stops at start with exit code 1 and `Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled (CLAUDE_CODE_USE_POWERSHELL_TOOL=0).` It sends no request.
- A **deny rule** `Bash`, `Bash(*)`, `PowerShell` or `PowerShell(*)` takes that tool out of the list, in any settings file. `Bash()`, `bash` and `Bash(git *)` do not. With both tools denied, Claude Code still starts.
- **`defaultShell`** changes nothing in the request. It is the shell for the commands typed after `!` in the prompt (documented), not the model's tool.
- The **edition** of PowerShell is in the second line of the PowerShell tool's description. Claude Code looks for `pwsh` on PATH, then `PowerShell\7\pwsh.exe` under the folder `ProgramW6432` names, then `.dotnet\tools\pwsh.exe` in the home folder, then `powershell` on PATH, then System32's. For Windows PowerShell 5.1 the description tells the model that `&&`, `||` and `?:` are not available.

**Where Claude Code looks for Git Bash** (identical on 2.1.295 and 2.1.299; the first hit wins):

1. `CLAUDE_CODE_GIT_BASH_PATH`, when it names an existing file called `bash.exe`, `sh.exe`, `bash` or `sh`, in any case. Forward and back slashes both work, a space before or after is trimmed, and a folder named `bash.exe` is accepted (only the name and that it exists are checked). The variable is read from the process environment and from the `env` of the user settings, which wins over the process environment. The `env` of the project and local settings is not used for this variable.
2. `C:\Program Files\Git\bin\bash.exe`, then `C:\Program Files (x86)\Git\bin\bash.exe`, written out: the `ProgramFiles` variable is not read.
3. The first line that `where.exe git` prints that exists, is not in the working folder (nor in a `node_modules` or virtual environment folder below it) and ends in `.com`, `.exe`, `.bat` or `.cmd`: two folders up from that file, `bin\bash.exe`. That works for `...\Git\cmd\git.exe`, the folder Git for Windows puts on PATH, and fails for `...\Git\mingw64\bin\git.exe`, which is two folders up from `mingw64`, not from the Git folder. Only the first line counts, so the order of PATH decides: with `mingw64\bin` before `cmd` Git Bash is not found, with `cmd` first it is. Git Bash itself starts with `mingw64\bin` first, so a Claude Code started from a Git Bash window, on a Git that is not under `C:\Program Files`, does not find it.

A `bash.exe` in `C:\Windows\System32` (the WSL launcher) is not used. Claude Code checks that the file exists and not that it starts: Git for Windows' `bin\bash.exe` starts `usr\bin\bash.exe`, so a half-removed install passes the check, and `check` tries `bash.exe -c "exit 0"` to say so.

**A `CLAUDE_CODE_GIT_BASH_PATH` that does not work** (the binary's answer, on both versions): it carries on. The value is ignored, the debug log says `CLAUDE_CODE_GIT_BASH_PATH "..." not found; falling back to auto-detection` (or `... is not a bash/sh binary; falling back to auto-detection`), and the search goes on as if the variable were not set. It is ignored when the file is not there, when its name is something else (`git-bash.exe`, `git.exe`, the `bin` folder), when it is in quote marks (they are part of the value), when it has a `%NAME%` in it (nothing expands it), and when it is a relative path. If the search finds Git Bash, the Bash tool is there; if not, the model gets the PowerShell tool, and with that tool off as well Claude Code stops at start. Claude Code's changelog says that before 2.1.219 a path that did not exist stopped it at start; that was not tried.

**The other `claude` commands.** `check` lists the `claude` files on PATH in the order a shell looks (each folder in turn, the extensions of `PATHEXT` in their order), and the places the installers use even when they are not on PATH. It asks each for `--version`, in a throwaway config folder with no `CLAUDE_*` or `ANTHROPIC_*` variable. The files are named by where they came from: the native installer, npm (a `claude.cmd` shim is run through `cmd.exe`, as a shell does), WinGet, the desktop app's bundles, an editor's extension. The desktop app's own launcher and a Microsoft Store alias are named and never run.

**What `fix` and `undo` write.** One value, `CLAUDE_CODE_GIT_BASH_PATH`, of type `REG_SZ`, in `HKCU\Environment`, with `reg add`; `undo` writes the old value with its old type back, or removes the value with `reg delete`. After either, they tell running programs that the environment changed, by setting and deleting a throwaway variable (`CLAUDE_WINDOWS_DOCTOR_NOTIFY`) with `setx` and `reg delete`, so that a terminal opened afterwards has the new value. The record is `<config folder>\windows-doctor\record.json`: the tool, a schema number, the version, the date, the name, the value that was set, the value and type that were there, and how the Git Bash was found. It is written first through a temporary file and a rename; if it cannot be written, the user environment is put back as it was. Everything else is read only.

### Privacy

It reads the files and registry values listed above, on your machine, and starts the programs listed above. It writes only with `fix` and `undo` (the one value of the user environment and the record next to it) and in throwaway folders in your temporary folder, which it removes afterwards. It has no network code except where a command's job is a local connection: `check --live` listens on 127.0.0.1 for the fake API that the real `claude` is pointed at, and connects to nothing else. Nothing is sent to Anthropic or to anyone else, there is no telemetry and no account. An environment variable's value is shown only when its name ends in `DIR`, `PATH`, `HOME`, `FILE` or `ROOT`, or the value is a switch (`0`, `1`, `true`, `false`, `yes`, `no`, `on`, `off`): a token in `ANTHROPIC_API_KEY` is shown as set, never its value, and a test holds that for the text, the markdown and the JSON report. Paths in the report contain your user name; remove them before you paste a report into an issue. A test fails if any file under `src/` or `bin/` imports anything but `node:` modules, if any file but `src/sys.mjs` and `src/live.mjs` can start a program, if any file but `src/live.mjs` can open a connection, or if any file but `src/write.mjs` can write a file. See also [SECURITY.md](SECURITY.md).

## What was verified, and how

Checked on 2026-10-16 on Windows 11 Home (build 10.0.26300, x64) with Node 24.19.0, git 2.55.0.windows.3 and Claude Code 2.1.295 and 2.1.299, the two versions the desktop app has bundled here; every real-binary check passed on both. Git for Windows is at `E:\Das\Git`, not under `C:\Program Files`. WSL 2.5.9.0 is installed with one distribution, `docker-desktop` (`wsl.exe --status`: default distribution docker-desktop, default version 2), so the WSL checks on this machine saw a Windows with nothing to work in. CI runs the unit tests on Linux, macOS and Windows with Node 20, 22 and 24 and on Linux with Node 18, and the real-binary checks on all three systems against the npm release of Claude Code. The badges at the top show the latest runs.

- **196 automated tests** (`npm test`, Node's own runner, no dependencies, about 13 seconds). `node --test` also reports each of the 7 helper files under `test/` as a passing test, on every Node version CI runs (18 to 24); those are not counted here (the runner's total was 203 on Windows, macOS and Linux). Without a Claude Code binary 168 pass on Windows and 28 are skipped: they are the real-binary checks below. On Linux and macOS 160 pass and 36 are skipped: those 28 and 8 that read or need the real Windows, where everything else runs on pretend machines. The tests cover:
  - the shell prediction: all 129 cases of the table on a pretend Windows machine (a clean one that a case spoils: Git trees, PATH, variables, settings files), `parseSwitch`, the reading of a Git Bash value, which variable counts from which file, the trail of the Git Bash search step by step (the fixed paths before PATH, a `git.exe` in the working folder or in a dependency folder below it skipped), the five places a PowerShell is looked for, and the account's default named and not guessed;
  - the settings loader: the files and their order (managed, local, project, user), `CLAUDE_CONFIG_DIR`, the managed settings from the registry, the folder and `HKCU` (the first with a policy key applies), drop-in files, a file that is not strict JSON, a byte-order mark, `env` by scope, numbers and booleans in `env`, deny rules;
  - the registry layer and the file that stands in for it: the `reg.exe` command lines (set, remove, the notification), the parsing of what `reg query` prints, a missing or failing `reg.exe`, names in any case, a type that is kept;
  - `fix` and `undo` (see below), and the code that writes: the record through a temporary file and a rename, a record that is not one, the throwaway folders;
  - each of the 27 findings, from a clean pretend Windows machine that a test spoils in one way: said when it should be, with its effect and its fix, and not otherwise; the `explain` pages (a page for every id, none for an id that cannot be emitted, every line marked verified, documented or not verified);
  - the reports: the text, the markdown (at most 12 findings, 500 characters a line, the fix kept whole, a line that says how many more), the JSON documents, plain words, and that no secret is in any of them (a token in the environment, in the registry or in a settings file is set, never its value);
  - `check --live`: what is copied from your setup and what is not, the fake API, the whole run against a stand-in for the binary (a `.cmd` shim on Windows, a shell script elsewhere), the comparison of what the binary listed with the prediction;
  - every `claude` on the machine: PATH order, `PATHEXT`, the places the installers use, the desktop app's launcher and a Store alias named and never run, a `claude` that cannot start, times out or prints no version;
  - the facts: git's configuration with its origin, long paths, the execution policy and what Claude Code adds, the code page, a stale `.git\index.lock` (a worktree's too), Node and npm; WSL: the UTF-16 output of `wsl.exe` with and without a byte-order mark, the columns, a header in another language, and the checks from inside a distribution;
  - the command line: every usage error, every exit code, the three forms of a report, the commands on a pretend Windows, Linux and macOS machine, and a child process on the real one;
  - the package files, the workflows and the README: its sections, commands and flags, the usage block, the table of finding ids, the JSON shapes, the Files table, the toolkit list, the numbers it quotes; the skill; the manifest; the icon; that only the places named in "Privacy" start a program, open a connection or write a file; no carriage return in a tracked file.
- **35 tests that run the real binary or read the real Windows** (`test/e2e-shell.test.mjs`, `test/e2e-platform.test.mjs`, `test/e2e-live.test.mjs`, `test/e2e-plugin.test.mjs`, `test/windows.test.mjs`; all of them run when `E2E_CLAUDE` names a Claude Code binary, and seven of the eight in `windows.test.mjs`, which only read the real Windows, run in `npm test` on Windows without one). Each of the binary's runs starts a fake Messages API on 127.0.0.1, so no model is reached and no token is spent; each has its own throwaway `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR` and a project folder that Claude Code already trusts, with the variables `DISABLE_AUTOUPDATER`, `DISABLE_TELEMETRY` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set and every `CLAUDE_*`, `ANTHROPIC_*` and `CLAUDECODE*` variable of the machine removed. The binary is started with `spawn` (asynchronously) and its standard input ignored. 34 of the 35 run on Windows and all 34 passed on 2.1.295 and on 2.1.299 (the 35th is the skill's check for Linux and macOS). The findings were the same on both versions unless a bullet says otherwise:
  - **Which shell tools, case by case.** The 129 cases of `test/shell-table.mjs`: fake Git for Windows trees made in a temporary folder (`git.exe` in `cmd`, in `mingw64\bin`, in `bin`, as `git.cmd`, in a shim folder; `bash.exe`, `BASH.EXE`, `sh.exe`, a folder named `bash.exe`), PATH orders, values of `CLAUDE_CODE_GIT_BASH_PATH` (nine valid spellings and nine that Claude Code ignores), 27 values of `CLAUDE_CODE_USE_POWERSHELL_TOOL`, the process environment and the user, project and local settings files in different combinations, whole-tool deny rules, and `defaultShell`. Each was built on a real disk and put to the binary: the tools of the first request, the exit code of `claude -p` and the `bash.exe` named in the debug log were what the table records and what `check` predicts, in every case. The same table is run against `check`'s prediction on a pretend Windows machine on every system. 122 of the 129 run on this machine (the 7 that need Git at `C:\Program Files\Git` cannot). On windows-latest, which has it, those 7 run, and the 65 that need it absent cannot; together the two cover every case. Of the 129, the first request listed the Bash tool alone 44 times, the PowerShell tool alone 46 times, both 22 times and neither 17 times, and in 13 of those Claude Code stopped at start.
  - **Where Git Bash is looked for.** The search in "How it works" is what those cases show. The debug log named the file the binary took (`Using bash path: "..."`) in every case that found one, and the reason in every case that ignored a variable. The Git of this machine was put to the binary as PATH can put it: with `E:\Das\Git\cmd` first Git Bash was found, and with `E:\Das\Git\mingw64\bin` first it was not, as predicted. The fake trees are real files, and `where.exe`, run by the binary, printed what the pretend machine of the offline tests says it prints. The binary is a bundled JavaScript program: its Git Bash search was read there to know which cases to build, and no rule in this README rests on that reading alone, each was seen in a run.
  - **A variable that points at a missing file.** The binary carried on with both versions: no error, the value ignored, `CLAUDE_CODE_GIT_BASH_PATH "..." not found; falling back to auto-detection` in the debug log, and the search went on. With Git Bash found by the search (PATH, or `C:\Program Files\Git`) the Bash tool was there; with none, the PowerShell tool only; with none and the PowerShell tool off, Claude Code stopped at start. A name that is not a bash or sh (`git-bash.exe`, `git.exe`, a folder) was ignored with `is not a bash/sh binary; falling back to auto-detection`, and so were a value in quote marks, a `%USERPROFILE%` in the value, and a relative path.
  - **The PowerShell tool.** 27 values of `CLAUDE_CODE_USE_POWERSHELL_TOOL` read as the "How it works" section says (on, off, and not set); a number or a boolean written in `env` reached Claude Code as text; the process environment and the user, project and local settings were combined in 10 cases of precedence, the nearest settings file winning over the process environment. The edition line of the tool's description was the one `check` names for 6 layouts (a `pwsh.exe` on PATH, under `ProgramW6432`, in `.dotnet\tools`, a `powershell.exe` first on PATH, `pwsh` after it, and System32's only); the files were empty stand-ins, not a real PowerShell 7. A PowerShell hook and the PowerShell tool both saw `Process Bypass` in `Get-ExecutionPolicy -List`; with `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY=1`, in the environment or in the user settings, both saw `Process Undefined`.
  - **`defaultShell`.** With `bash`, `powershell` and `cmd` (not a value the settings accept) in the user settings, in three states (Bash only, both tools, PowerShell only), 9 runs: the tools, the system prompt and the size of the request were those of the same state without it. One more case of the table has it in the project settings: the same tools.
  - **No shell tool.** With no Git Bash and `CLAUDE_CODE_USE_POWERSHELL_TOOL=0` Claude Code exited with code 1, sent no request, and printed `Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled (CLAUDE_CODE_USE_POWERSHELL_TOOL=0).` With both tools denied by rules it started.
  - **What the model's tools do on Windows** (the explain pages of `autocrlf`, `code-page` and `long-paths` rest on these). Claude Code's Write tool wrote a new file with LF only, and its Edit tool kept the CRLF of a file it changed. Under code page 437, `cmd.exe /c dir /b` through the Bash tool printed replacement characters for `café-über.txt`; through the PowerShell tool, which sets code page 65001, it was right. The Write tool wrote a file at a path of 391 characters with `LongPathsEnabled` on (the case with it off was not tried: the tool never changes the registry of the machine it runs on). `claude doctor` said `Native installation exists but ...\.local\bin is not in your PATH` for the desktop app's bundle (on 2.1.295 and 2.1.299) and, for the npm install of CI (2.1.301), `Running: npm-global` and `No installation issues found`, with nothing about PATH; and with the variables of these runs it said `Feature-flag evaluation disabled (disabled by CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)`.
  - **`check --live`.** Six cases through the whole command, each ending `proved`: a valid variable (the binary listed Bash and took that file), `mingw64\bin` first on PATH (PowerShell only, and the finding names the fix), `cmd` first (Bash, found through `where git`), no Git Bash with the PowerShell tool off (the binary stopped at start with no request, and the finding is an error), the settings that are copied (the PowerShell variable in the user settings turned the second tool on, a deny rule for Bash took the first away, the PowerShell variable in the project settings counted; a hook in the user settings did not run, and a key in the settings did not reach the output), and a `claude` that is not there (said, exit 1).
  - **On the CI runners**, with Claude Code 2.1.301, the npm release of 16 October 2026. On windows-latest (Git for Windows at `C:\Program Files\Git`, PowerShell 7 at `ProgramW6432`) 30 of the 35 ran and passed; the other five are the skill check for Linux and macOS and four that need a machine with no Git at the default place. They included 64 of the 129 cases, the 6 layouts of the PowerShell edition (with a real PowerShell 7 on the machine), 6 runs of `defaultShell`, the execution policy (`Process Bypass`, and `Process Undefined` with the respect variable), the code page (437 for the Bash tool, 65001 for the PowerShell tool), a path of 397 characters, `check --live` in the three setups that do not depend on where Git is, and the plugin (a plain prompt's request: 78,662 characters with and without it). On Linux and macOS the 7 that apply passed: the plugin validates, a plain prompt's request has the same size with and without the plugin (64,688 characters on Linux, 65,667 on macOS), `/windows-doctor:check` reached the model with `Nothing to check on Linux` (and `macOS`) after the Bash tool ran the command with no prompt, and a skill whose command exits 1 never reached the model.
- **`fix` and `undo`**, never against the registry of a machine under test. The code that talks to the registry is held to the `reg.exe` command lines it would run on a pretend machine, and everything else runs against a file that stands in for `HKCU\Environment` (`test/fix.test.mjs`, `test/winenv.test.mjs`, `test/write.test.mjs`): `fix` sets the value with a record, a second `fix` does nothing, `undo` removes the value and deletes the record, a second `undo` does nothing; an old value is kept in the record with its type and put back; only `reg add` and `reg delete` of this one value, and the notification, are ever run; `--path` takes a `bash.exe` or a Git folder and refuses a bad path with the reason; a value in the user or managed settings makes `fix` do nothing when it works and refuse when it does not; no Git Bash on the machine is refused; a registry or a record that cannot be written leaves the user environment as it was; a value changed since `fix` is left alone by `undo`; both refuse off Windows (Linux and macOS, with the same reason) and write nothing. On the real command line (`test/windows.test.mjs`, Windows only), `fix --git-bash --path` and `undo` through the file layer changed the file and wrote the record in the config folder, and the real `CLAUDE_CODE_GIT_BASH_PATH` value of `HKCU\Environment` was read before and after: the same.
- **The real Windows**, read only, each cross-checked against a second way of asking (`test/windows.test.mjs`): the names in `HKCU\Environment` through `reg.exe` and through .NET; `LongPathsEnabled` and the ANSI code page through `reg.exe` and through PowerShell's `Get-ItemProperty`; the execution policy of `CurrentUser` through `Get-ExecutionPolicy -List` and through `-Scope CurrentUser`; git's `core.autocrlf` through `git config --get`; the distributions of `wsl.exe -l -v` (UTF-16 output, decoded) against `wsl.exe -l -q`; every Git Bash file the tool names, started with `-c "echo ok"`; and the `claude` of the oracle, found on a PATH that has its folder first, with the version `--version` prints. The console's code page (`chcp`), Node and npm were read, and not cross-checked.
- **The plugin.** `claude plugin validate` and `claude plugin validate --strict` pass on both versions. With `--plugin-dir` the prompt `/windows-doctor:check` reached the model with the report for the project and the instruction after it, also when the report holds findings: a skill whose command line exits 1 never reached the model (0 requests), and the same skill with a command that exits 0 did, which is why the markdown report exits 0. When the shell tool was not allowed for the command, Claude Code handed the model `[run this first, exactly as written, with the PowerShell tool and use its output: ...]` with the plugin folder and the project folder filled in (2.1.295 and 2.1.299, with the PowerShell tool as the only shell tool; 2.1.301 on windows-latest, which has both tools, leaves out `with the PowerShell tool`), and the skill's text reads right both ways. With `allowed-tools` the model ran the command through the PowerShell tool with no prompt in the default permission mode (`permission_denials` empty). The figures in "What it costs in tokens" are from these captures. `claude plugin details` for the plugin installed from a local marketplace: `Always-on: ~11 tok`, `check < 20` always-on and about 100 when used. On Linux and macOS the skill's command is run when the prompt is built and its answer pasted (CI): `Nothing to check on Linux` or `macOS`.
- **From GitHub.** `npx -y github:nrzz/claude-windows-doctor check --project <folder> --markdown` ran from the published repository with a throwaway npm cache, home folder and config folder. It printed the report after 12 seconds on Windows 11 with Node 24.19.0, the download from GitHub and the start included.
- **The issue counts** in the first paragraph are those of 16 October, from the pitch for this tool; read again on 17 October with GitHub's search, they were 886 open issues with "windows" in the title, 477 outside the desktop and Cowork labels, and 174 naming Git Bash, PowerShell or WSL, and #7490 had 148 reactions.

## Not verified

- **Windows 10 and ARM64.** Every run was on Windows 11 on x64 (this machine, and the `windows-latest` runner of CI). Whether the registry reads, `where.exe`, `wsl.exe` and the Git Bash search behave the same on Windows 10 or on Windows on ARM, with the ARM build of Git for Windows, was not tried.
- **The Microsoft Store Git, Cygwin and MSYS2 without Git for Windows.** The Git that the Store installs, and a `bash.exe` from Cygwin or MSYS2, were not put to the binary. `check` looks for Git Bash only in the places Git for Windows, scoop and Chocolatey use. Claude Code accepts any existing file called `bash.exe` as `CLAUDE_CODE_GIT_BASH_PATH` (the cases show it checks the name and that the file exists), but whether the Bash tool works on top of an MSYS2 or Cygwin shell was not tried.
- **The desktop app's own shell choice.** The Claude desktop app bundles `claude.exe` (this tool lists the bundles) and starts it its own way; which shell and which environment its Code tab gives the binary was not driven. What `check` says is what a terminal gives Claude Code.
- **The VS Code extension.** Not driven. The extension runs its own binary with the environment VS Code has, which is the environment VS Code was started with ([#8674](https://github.com/anthropics/claude-code/issues/8674) is about it); `check` lists the extension's binary, and says nothing about how the extension reads its settings.
- **The PowerShell tool when Git Bash is found and the variable is not set.** Claude Code decides with the account (documented: on for claude.ai and Console accounts, off for Bedrock, Vertex and Foundry). The fake API has no account, and there the tool was off; the real default for an account was not seen, and `check` says "decided by your account" instead of yes or no.
- **PowerShell 7 beyond what CI ran.** The `pwsh` lookups were put to the binary with empty stand-in files, to read the edition line of the tool's description, and this machine has no PowerShell 7. The `windows-latest` runner has one, and there the execution policy, the code page and the plugin checks went through the PowerShell tool with `pwsh`; nothing else that 7 does differently from 5.1 was run. A `pwsh` that is a Microsoft Store alias is modelled and not tried.
- **Managed settings.** The registry policy (`HKLM` and `HKCU\SOFTWARE\Policies\ClaudeCode`, the value `Settings`) and `C:\Program Files\ClaudeCode\managed-settings.json` with `managed-settings.d` are read the way the documentation describes them. The real binary was not put to either, because writing them needs an administrator and this tool and its tests never change the machine. A Group Policy execution policy was not tried either.
- **WSL from inside a distribution.** The WSL side of `check` is held to pretend machines (`/proc/version`, the paths through `/mnt/c`); it was not run in a real distribution, because the only one here is `docker-desktop`. From Windows, `wsl.exe` was read for real. The finding that the config folder or the project is on `/mnt/c` is a statement from Microsoft's documentation, not a timing.
- **Long paths switched off, other code pages, other policies.** The Write tool was seen writing a path of 391 characters with `LongPathsEnabled` on; the case with it off was not tried. The code page was 437 for the Bash tool and 65001 for the PowerShell tool; other code pages were not tried. The execution policy of this machine is `RemoteSigned` for the current user; `Restricted` and `AllSigned` were not tried.
- **How a stale `.git\index.lock` comes about.** `check` looks for the file and for a running `git.exe`. How Claude Code's Bash tool leaves one behind ([#28546](https://github.com/anthropics/claude-code/issues/28546)) was not reproduced.
- **Claude Code before 2.1.295.** The changelog says that before 2.1.219 a `CLAUDE_CODE_GIT_BASH_PATH` that does not exist stopped Claude Code at start; that is documentation, and was not tried. A Claude Code newer than 2.1.299 is put to the checks by CI every week (the newest npm release), so a release that changes how it finds its shell shows up there as a red job.
- **A running session and the `!` commands.** Every run starts a new `claude -p` process after the files are written. Whether a running session picks up a changed environment or settings file, and what `defaultShell` does for the commands typed after `!`, was not driven (it is interactive).
- **Token counts.** Every token figure is characters / 4, an estimate, and not a count by Claude's tokenizer.
- **Linux and macOS** are covered by CI only (the "nothing to check" answer and the skill); nothing was run on either by hand.
- **The marketplace line.** `/plugin install windows-doctor@claude-code-toolkit` has not been tried: the toolkit's marketplace lists the plugin only after the hub is updated. The plugin installs and validates from a local marketplace folder.

## Files

| Path | What it is |
| --- | --- |
| `bin/claude-windows-doctor.mjs` | The command |
| `src/cli.mjs` | The options, the help and the exit codes |
| `src/sys.mjs`, `src/winpath.mjs`, `src/jsonfile.mjs` | The machine as the checks see it (platform, environment, files, programs); Windows path rules that behave the same on every system; reading a JSON file the way Claude Code does |
| `src/settings.mjs` | The settings files that bear on the shell: `env`, `defaultShell`, deny rules, `wslInheritsWindowsSettings` |
| `src/shell.mjs`, `src/gitbash.mjs` | Which shell tools Claude Code gives the model, and why; where a Git Bash is on this machine |
| `src/binaries.mjs` | Every `claude`: where it came from, its version, which one runs first |
| `src/facts.mjs`, `src/userenv.mjs`, `src/wsl.mjs`, `src/winenv.mjs` | Node and npm, long paths, `core.autocrlf`, the execution policy, the code page, `.git\index.lock`; the user environment against this process; WSL; the registry through `reg.exe` |
| `src/check.mjs`, `src/findings.mjs`, `src/explain.mjs` | `check`; the findings and their ids; the pages of `explain` |
| `src/fix.mjs`, `src/write.mjs` | `fix` and `undo`; the only code that writes a file: the record, the throwaway folders, the file that stands in for the registry |
| `src/live.mjs` | `check --live`: the fake API and the real binary; the only code that opens a connection |
| `src/report.mjs` | The text, markdown and JSON reports |
| `src/version.mjs` | The version number, which `package.json` and `plugin.json` must agree with |
| `skills/check/` | `/windows-doctor:check`, the user-only skill |
| `.claude-plugin/` | The plugin manifest and its icon |
| `test/` | `npm test`. `machine.mjs` and `win-machine.mjs` are pretend machines (a clean Windows one that a test spoils in one way), `shell-table.mjs` holds the 129 cases the prediction is held to, `claude-sandbox.mjs` runs the real binary through a fake API, `e2e-*.test.mjs` put the claims to it, `windows.test.mjs` reads the real Windows |

Related: [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor) shows the merged settings and lints them against the schema, [claude-relocate](https://github.com/nrzz/claude-relocate) moves the config folder and sets `CLAUDE_CONFIG_DIR` in the user environment the way `fix` sets the Git Bash path, and [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor) explains why a permission prompt appeared.

## Contributing

Issues and pull requests are welcome: start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](https://github.com/nrzz/claude-windows-doctor/issues?q=is%3Aopen+label%3A%22good+first+issue%22). For a wrong prediction of the shell, send where Git for Windows is installed, the output of `check --json` (with anything private removed) and which tools Claude Code really gave the model; that becomes a row of the table. Questions go to [Discussions](https://github.com/nrzz/claude-windows-doctor/discussions); security reports go through [SECURITY.md](SECURITY.md).

## Part of the Claude Code toolkit

Small, dependency-free tools that make Claude Code cheaper, safer and easier to share, all in the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit):

- [claude-code-handover](https://github.com/nrzz/claude-code-handover): short sessions with a handover file every new session loads by itself
- [claude-code-team-sync](https://github.com/nrzz/claude-code-team-sync): share sessions, notes and team context with coworkers
- [claude-code-glow](https://github.com/nrzz/claude-code-glow): themes for the whole interface, a status line and a live HUD
- [claude-code-guardrails](https://github.com/nrzz/claude-code-guardrails): safety presets that stop risky commands and edits
- [claude-code-notify](https://github.com/nrzz/claude-code-notify): a ping when Claude needs you or finishes
- [claude-cost-guard](https://github.com/nrzz/claude-cost-guard): daily and weekly token budgets with zero-token warnings
- [claude-md-doctor](https://github.com/nrzz/claude-md-doctor): what your CLAUDE.md costs every session, and how to slim it
- [claude-code-starter-kits](https://github.com/nrzz/claude-code-starter-kits): a lean, safe .claude/ for your stack in one command
- [claude-session-replay](https://github.com/nrzz/claude-session-replay): search past sessions and export one as an HTML replay
- [claude-chat-ferry](https://github.com/nrzz/claude-chat-ferry): continue a Cursor or Antigravity chat in Claude Code, or hand a session to them
- [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor): why a permission prompt appeared, dead rules, rules from your history
- [claude-session-tidy](https://github.com/nrzz/claude-session-tidy): list, delete, keep and restore your sessions before the 30-day sweep
- [claude-hook-bench](https://github.com/nrzz/claude-hook-bench): run every hook with the JSON Claude Code sends, and see what each one does
- [claude-relocate](https://github.com/nrzz/claude-relocate): move Claude Code's config folder to another drive or the XDG folders, safely, with undo
- [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor): a commented settings.jsonc that builds settings.json, the merged settings with their source, a lint against the schema
- [claude-automode-doctor](https://github.com/nrzz/claude-automode-doctor): what auto mode and its classifier decided, from your transcripts, plus a lint of the autoMode settings
- [claude-mcp-check](https://github.com/nrzz/claude-mcp-check): every MCP server Claude Code would load, from which file, whether it starts, and what its tools cost
- [claude-sandbox-doctor](https://github.com/nrzz/claude-sandbox-doctor): whether Claude Code's Bash sandbox works on this machine, and why a command ran inside it, outside it, or not at all

Set up any of them, or all of them, from one page: `npx -y github:nrzz/claude-code-toolkit` opens it with the recommended tools switched on.

If one of them saves you tokens, a star on its repository helps other people find it, and following [@nrzz](https://github.com/nrzz) on GitHub shows you new tools and releases.

## License

MIT
