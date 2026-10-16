# Contributing to claude-windows-doctor

Thanks for helping. claude-windows-doctor is a CLI and a Claude Code plugin with one user-only skill, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit). The bar for a change is the bar the code already meets: it is tested, it works on Windows, macOS and Linux (on the last two the tool says it has nothing to check, and its Windows logic runs against a pretend Windows machine), it changes nothing on the computer it runs on except the one value that `fix` sets, and it never wastes anyone's tokens.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/claude-windows-doctor/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/claude-windows-doctor/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/claude-windows-doctor/issues/new/choose) with the Claude Code version (`claude --version`), the Windows version (`winver`), `node --version`, `git --version`, and the exact command and output. For a wrong prediction of the shell, add where Git for Windows is installed and the output of `claude-windows-doctor check --json` with anything private removed, and if you can run it, `claude-windows-doctor check --live`, which asks the real binary.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/claude-windows-doctor
cd claude-windows-doctor
npm test
```

- `node bin/claude-windows-doctor.mjs check --project <a project>` is the tool, `explain <id>` explains a finding.
- `E2E_CLAUDE=<path to claude> node --test --test-concurrency=1 test/e2e-shell.test.mjs test/e2e-platform.test.mjs test/windows.test.mjs test/e2e-live.test.mjs test/e2e-plugin.test.mjs` also puts the tool's claims about Claude Code to the real binary (see below). Most of them need Windows.
- Point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at a temporary folder whenever you run the tool, the tests or `claude` by hand; the tests do it for themselves. Never test against your real `~/.claude` or `~/.claude.json`.
- To try `fix` and `undo` without touching the registry, set `CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE` to a JSON file: the tool reads and writes that file where it would use `HKCU\Environment`. The tests do this for themselves, the moment `test/helpers.mjs` loads.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/claude-windows-doctor.mjs` | the CLI entry |
| `src/cli.mjs` | the options, the help, the exit codes |
| `src/sys.mjs` | the machine as the checks see it (platform, environment, files, programs); the one place that starts a program for them |
| `src/winpath.mjs`, `src/jsonfile.mjs` | Windows path rules that behave the same on every system; reading a JSON file the way Claude Code does |
| `src/settings.mjs` | the settings files that bear on the shell (managed, local, project, user): `env`, `defaultShell`, deny rules, `wslInheritsWindowsSettings` |
| `src/shell.mjs`, `src/gitbash.mjs` | which shell tools Claude Code gives the model, and why: the order in which it looks for Git Bash; where a Git Bash is on this machine |
| `src/binaries.mjs` | every `claude` on PATH and in the places the installers use, with its version and which one runs first |
| `src/facts.mjs`, `src/userenv.mjs`, `src/wsl.mjs`, `src/winenv.mjs` | Node and npm, long paths, `core.autocrlf`, the execution policy, the code page, `.git\index.lock`; the user environment against this process; WSL; the registry through `reg.exe` |
| `src/check.mjs`, `src/findings.mjs`, `src/explain.mjs` | `check`; the findings and their ids; the pages of `explain` |
| `src/fix.mjs`, `src/write.mjs` | `fix --git-bash` and `undo`; the only code that writes a file: the record, the throwaway folders, the file that stands in for the registry |
| `src/live.mjs` | `check --live`: the fake API on 127.0.0.1 and the real binary; the only code that opens a connection |
| `src/report.mjs` | the text, markdown and JSON reports |
| `skills/check/`, `.claude-plugin/` | the user-only skill; the plugin manifest and icon |
| `test/*.test.mjs` | unit tests; the `e2e-*.test.mjs` files and `windows.test.mjs` run against the real binary and the real Windows when they can |
| `test/machine.mjs`, `test/win-machine.mjs` | a pretend machine, and a clean pretend Windows machine that a test spoils in one way |
| `test/shell-table.mjs`, `test/table-lib.mjs` | the cases the shell prediction is held to, and how a case becomes a pretend machine or real files |
| `test/claude-sandbox.mjs`, `test/fake-claude.mjs` | running the real binary at zero cost through a fake API; a stand-in for it |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged. Only `src/sys.mjs` and `src/live.mjs` may start a process, only `src/live.mjs` may open a connection, and only `src/write.mjs` may write a file; a test fails otherwise.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18, and the real-binary checks on Windows, macOS and Linux; a change that only works on one of them is not done. Windows logic is written with `path.win32` only, so that it runs on a pretend Windows machine on every system.
3. **The binary is right.** The prediction of the shell says what Claude Code does because the real binary was put to it. When one is wrong, add the case as a row of `test/shell-table.mjs` (the same row runs on a pretend machine and against the binary), run `E2E_CLAUDE=... node --test test/e2e-shell.test.mjs`, fix the code, and say so in the README's "What was verified". Do not change an expectation to make a test pass without running it against the binary.
4. **Token cost is a feature.** The tool runs outside Claude; the one skill is user-only and its report is capped. If your change puts anything new in front of Claude, say how many tokens in the pull request and update the README's "What it costs in tokens".
5. **The computer is the user's.** Nothing changes anything except `fix --git-bash` and `undo`, and they change one value of the Windows user environment, with a record of what was there and `--dry-run`. No test writes the real registry, the real Git configuration or the real execution policy; the tests that read them only read.
6. **Never touch real user data in tests.** Use a temporary folder and point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at it, in the same command, whenever you run the tool, `claude` or anything else that reads them. `test/helpers.mjs` points every way the tool finds a config folder, and the user environment, at throwaway places the moment it loads.
7. **Nothing secret in the output.** The value of an environment variable is shown only when its name says it is a path or a switch; any other value is shown as "set". A new report needs a test that a secret in the environment is not in it.
8. **Keep the README honest.** Its "What was verified, and how" section says what was checked and what was not. If your change affects either, update it in the same pull request.

## The real-binary checks

The `test/e2e-*.test.mjs` files start a fake Messages API on 127.0.0.1 and run the real Claude Code binary against it, with a throwaway `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR`. They put the claims of the README to it: which tools the first request lists for every case of the shell table (fake Git trees, PATH orders, variables, settings files, deny rules), which `bash.exe` the binary says it took, which edition of PowerShell it runs, what `defaultShell` changes, what the plugin and its skill cost. No model is reached and nothing leaves your machine. The binary is started asynchronously with its standard input ignored (a synchronous start blocks the fake server, and `-p` waits for input on an open stdin).

```bash
E2E_CLAUDE=/path/to/claude node --test --test-concurrency=1 test/e2e-shell.test.mjs test/e2e-platform.test.mjs test/windows.test.mjs test/e2e-live.test.mjs test/e2e-plugin.test.mjs
```

The checks that are about Windows skip on other systems; `windows.test.mjs` reads the real registry, `wsl.exe`, PowerShell, `chcp` and git (read only) on the Windows jobs of `npm test`, with or without a binary.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Warn when the Git Bash variable holds quotes").
- Fill in the pull request template; CI must be green on every job.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `src/version.mjs`, `package.json` and `.claude-plugin/plugin.json` (`npm test` fails until every copy agrees), add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
