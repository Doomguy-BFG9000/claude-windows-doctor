# Changelog

All notable changes to claude-windows-doctor are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Add `explain --list`, with text and JSON output, to list every finding id and title.

## [1.0.0] - 2026-10-16

- First release. A CLI and a Claude Code plugin with one user-only skill, `/windows-doctor:check`.
- `check` says, on Windows, which shell tools Claude Code gives the model and why: the three places Claude Code looks for Git Bash in its order and what each answered, `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_USE_POWERSHELL_TOOL`, the whole-tool deny rules and `defaultShell` (which changes nothing in the model's tools), and the edition of PowerShell the tool runs. It lists every `claude` on PATH and in the places the installers use (the native installer, npm, WinGet, the desktop app's bundles, an editor's extension) with its version and which one a terminal runs first, and finds the setup problems behind common Windows issues: Node and npm, long paths, `core.autocrlf`, the PowerShell execution policy, the console code page, a stale `.git\index.lock`, `CLAUDE_*` and `ANTHROPIC_*` variables that are in the user environment and not in the terminal (or the other way round), and WSL. Inside a WSL distribution it checks the WSL side. On Linux and macOS it says there is nothing to check and exits 0. 27 findings, each with an id, a severity, what Claude Code does about it, and a fix.
- `check --live` proves the answer with the real `claude`: it starts the binary against a fake Messages API on 127.0.0.1 in a throwaway folder, reads the tools of the first request and the `bash.exe` the binary says it took, and compares them with the prediction. No token is spent.
- `check --markdown` is the short report of the skill: at most 12 findings, 500 characters a line, 16 lines; it always exits 0, because Claude Code drops a skill whose command fails.
- `fix --git-bash` sets `CLAUDE_CODE_GIT_BASH_PATH` in the Windows user environment for a Git Bash that Claude Code does not find, after recording what was there, and `undo` puts it back. Both take `--dry-run` and refuse off Windows. They change that one value and nothing else.
- `explain <finding-id>` prints what a finding means, what Claude Code does in that case (each line marked verified, documented or not verified), the fix and the issue threads.
- What Claude Code does is what the real binary did: `test/shell-table.mjs` holds 129 cases (fake Git trees, PATH orders, spellings of the two variables, settings files, deny rules, `defaultShell`) that were put to Claude Code 2.1.295 and 2.1.299 on Windows 11 and, in CI, to the newest release (2.1.301) on `windows-latest`, and the same table is held against the prediction on a pretend Windows machine on every system. Git Bash is looked for in `CLAUDE_CODE_GIT_BASH_PATH`, then `C:\Program Files\Git` and `C:\Program Files (x86)\Git`, then two folders up from the first `git.exe` that `where.exe` prints; a variable that points at a missing file is ignored and the search goes on.
- Zero tokens for the tool. The skill is user-only, adds nothing to a request that does not use it, and hands the model a report of at most 12 findings.

[1.0.0]: https://github.com/nrzz/claude-windows-doctor/releases/tag/v1.0.0

[Unreleased]: https://github.com/nrzz/claude-windows-doctor/compare/v1.0.0...HEAD
