// Each finding, from a clean pretend Windows machine that a test spoils in one way: it is said when it should be, with its effect and its fix, and not otherwise.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { HOME, NATIVE, POLICY, PROJECT, collect, idsOf, utf16, winMachine } from "./win-machine.mjs";
import { collectWsl } from "../src/check.mjs";
import { IDS } from "../src/explain.mjs";

const find = (facts, id) => facts.findings.find((f) => f.id === id);
const out = (stdout, status = 0) => ({ status, stdout, stderr: "" });
const E_GIT = ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe", "E:\\Das\\Git\\usr\\bin\\bash.exe"];
const REG_GIT = { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "E:\\Das\\Git"] } };

test("a clean machine has no finding, and the numbers say so", () => {
  const f = collect(winMachine());
  assert.deepEqual(idsOf(f), []);
  assert.deepEqual(f.counts, { error: 0, warning: 0, note: 0 });
  assert.equal(f.shell.gitBash.how, "program-files");
  assert.equal(f.binaries.first.path, NATIVE);
});

test("every finding has an effect and a fix, and a page in explain; the kinds are errors, warnings and notes", () => {
  const spoiled = [
    winMachine({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }),
    winMachine({ noGit: true, files: E_GIT, env: { Path: `E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows`, CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" }, texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "cmd" }) } }),
  ];
  const seen = new Set();
  for (const s of spoiled) for (const x of collect(s).findings) { seen.add(x.id); assert.ok(x.effect && x.fix, `${x.id} has an effect and a fix`); assert.ok(IDS.includes(x.id), `${x.id} has a page`); assert.ok(["error", "warning", "note"].includes(x.severity)); }
  assert.ok(seen.size >= 4);
});

test("no-shell-tool: Git Bash not found and the PowerShell tool off is an error, and the fix names a Git Bash that exists", () => {
  const f = collect(winMachine({ noGit: true, files: E_GIT, env: { Path: `E:\\Das\\Git\\mingw64\\bin;C:\\Windows\\System32;C:\\Windows`, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }));
  const x = find(f, "no-shell-tool");
  assert.equal(x.severity, "error");
  assert.match(x.message, /Claude Code will not start/);
  assert.match(x.message, /CLAUDE_CODE_USE_POWERSHELL_TOOL is "0" in the process environment/);
  assert.match(x.effect, /exits at start with .*requires a shell tool.* \(exit code 1\)/);
  assert.match(x.fix, /E:\\Das\\Git\\bin\\bash\.exe: claude-windows-doctor fix --git-bash/);
  assert.equal(f.shell.fatal.id, "no-shell-tool");
  assert.ok(!idsOf(f).includes("git-bash-not-found"), "one finding for one cause");
  const noGit = find(collect(winMachine({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "no" } })), "no-shell-tool");
  assert.match(noGit.fix, /Remove CLAUDE_CODE_USE_POWERSHELL_TOOL=0 from the process environment, or install Git for Windows/);
  assert.ok(!idsOf(collect(winMachine({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }))).includes("no-shell-tool"), "with Git Bash found, off is only the end of the PowerShell tool");
});

test("git-bash-not-found: Git for Windows is on this machine and the first git.exe of where git is in mingw64\\bin", () => {
  const f = collect(winMachine({ noGit: true, files: E_GIT, env: { Path: `E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } }));
  const x = find(f, "git-bash-not-found");
  assert.equal(x.severity, "warning");
  assert.match(x.message, /Git for Windows is installed \(E:\\Das\\Git\\bin\\bash\.exe\), but Claude Code does not find it: where git prints E:\\Das\\Git\\mingw64\\bin\\git\.exe first, and two folders up from it bin\\bash\.exe would be E:\\Das\\Git\\mingw64\\bin\\bash\.exe, which is not there\./);
  assert.match(x.effect, /the PowerShell tool only/);
  assert.match(x.fix, /fix --git-bash sets CLAUDE_CODE_GIT_BASH_PATH=E:\\Das\\Git\\bin\\bash\.exe.*put the Git cmd folder before mingw64\\bin on PATH/);
  const noPath = find(collect(winMachine({ noGit: true, files: E_GIT, registry: REG_GIT, env: { Path: "C:\\Windows\\System32;C:\\Windows" } })), "git-bash-not-found");
  assert.match(noPath.message, /git\.exe is not on PATH/);
  assert.ok(!/mingw64/.test(noPath.fix), "no PATH advice when git is not on PATH");
  const registryOnly = collect(winMachine({ noGit: true, files: ["D:\\Tools\\Git\\bin\\bash.exe"], env: { Path: "C:\\Windows\\System32;C:\\Windows" }, registry: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "D:\\Tools\\Git"] } } }));
  assert.match(find(registryOnly, "git-bash-not-found").message, /D:\\Tools\\Git\\bin\\bash\.exe/);
  assert.ok(!idsOf(collect(winMachine({ noGit: true }))).includes("git-bash-not-found"), "no Git for Windows on the machine: nothing to find");
});

test("git-bash-path-ignored: a value that Claude Code does not accept, with the reason and the hint; it names a Git Bash that exists", () => {
  const files = ["E:\\Das\\Git\\bin\\git-bash.exe", ...E_GIT];
  const bad = collect(winMachine({ noGit: true, files, registry: REG_GIT, env: { Path: "C:\\Windows\\System32;C:\\Windows", CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\git-bash.exe" } }));
  const a = find(bad, "git-bash-path-ignored");
  assert.match(a.message, /is "E:\\Das\\Git\\bin\\git-bash\.exe" \(the process environment\), and Claude Code ignores it: the file is not named bash\.exe, sh\.exe, bash or sh\./);
  assert.match(a.effect, /found none, so the Bash tool is not offered/);
  assert.match(a.fix, /Point it at E:\\Das\\Git\\bin\\bash\.exe/);
  const quoted = collect(winMachine({ env: { CLAUDE_CODE_GIT_BASH_PATH: "\"C:\\Program Files\\Git\\bin\\bash.exe\"" } }));
  assert.match(find(quoted, "git-bash-path-ignored").message, /quote marks/);
  assert.match(find(quoted, "git-bash-path-ignored").effect, /found C:\\Program Files\\Git\\bin\\bash\.exe/, "the search goes on: it found the fixed path");
  const pct = collect(winMachine({ env: { CLAUDE_CODE_GIT_BASH_PATH: "%ProgramFiles%\\Git\\bin\\bash.exe" } }));
  assert.match(find(pct, "git-bash-path-ignored").message, /there is no such file\. The value has a %NAME% in it, which is not expanded/);
  const missing = find(collect(winMachine({ noGit: true, env: { CLAUDE_CODE_GIT_BASH_PATH: "D:\\nope\\bash.exe" } })), "git-bash-path-ignored");
  assert.match(missing.fix, /Set it to the full path of bash\.exe, or remove it/);
});

test("git-bash-path-project-settings: the variable in a project or local file, which Claude Code does not read for it", () => {
  const f = collect(winMachine({ noGit: true, files: E_GIT, registry: REG_GIT, env: { Path: "C:\\Windows\\System32;C:\\Windows" }, texts: { [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\bash.exe" } }), [`${PROJECT}\\.claude\\settings.local.json`]: JSON.stringify({ env: { CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\bash.exe" } }) } }));
  const hits = f.findings.filter((x) => x.id === "git-bash-path-project-settings");
  assert.equal(hits.length, 2);
  assert.match(hits[0].message, /env of the (local|project) settings \(\.claude\\settings\.(local\.)?json\)/);
  assert.match(hits[0].fix, /claude-windows-doctor fix --git-bash \(it sets E:\\Das\\Git\\bin\\bash\.exe\)/);
});

test("git-bash-broken: Git Bash is found and does not start", () => {
  const f = collect(winMachine({ commands: { bash: () => ({ status: 127, stdout: "", stderr: "Skipping command-line 'usr\\bin\\bash.exe' (not found)\nNeed a valid command-line" }) } }));
  const x = find(f, "git-bash-broken");
  assert.match(x.message, /would use C:\\Program Files\\Git\\bin\\bash\.exe, but it does not start \(it exited with code 127: Skipping command-line/);
  const spawnFail = winMachine();
  const base = spawnFail.run;
  spawnFail.run = (cmd, args, opts) => (/bash\.exe$/i.test(String(cmd)) ? { status: null, stdout: "", stderr: "", error: Object.assign(new Error("x"), { code: "EFTYPE" }), timedOut: false } : base(cmd, args, opts));
  assert.match(find(collect(spawnFail), "git-bash-broken").message, /could not be started: EFTYPE/);
  assert.ok(!idsOf(collect(winMachine())).includes("git-bash-broken"));
  assert.equal(collect(winMachine()).bashStarts.ok, true);
  assert.equal(collect(winMachine({ noGit: true })).bashStarts.checked, false, "nothing is started when no Git Bash is found");
});

test("powershell-variable-unread: a value that Claude Code reads as not set", () => {
  const x = find(collect(winMachine({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" } })), "powershell-variable-unread");
  assert.match(x.message, /is "enabled" \(the process environment\), which Claude Code reads as not set/);
  assert.match(x.effect, /1, true, yes and on as on, and 0, false, no and off as off/);
  for (const v of ["1", "0", "true", "no", ""]) assert.ok(!idsOf(collect(winMachine({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: v } }))).includes("powershell-variable-unread"), JSON.stringify(v));
});

test("default-shell-scope: defaultShell is said not to be the model's tool, whatever its value; a value it does not allow is named", () => {
  const f = collect(winMachine({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "powershell" }), [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "cmd" }) } }));
  const hits = f.findings.filter((x) => x.id === "default-shell-scope");
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.severity === "note" && /not the tool the model gets/.test(h.message)));
  assert.ok(hits.some((h) => /Claude Code takes only "bash" or "powershell"/.test(h.message)));
  assert.match(hits[0].effect, /same with it and without it/);
});

test("powershell-5: the PowerShell tool runs Windows PowerShell 5.1 when it is on and no pwsh is found; not when pwsh is there or the tool is not sure to be on", () => {
  assert.ok(idsOf(collect(winMachine({ noGit: true }))).includes("powershell-5"));
  assert.ok(idsOf(collect(winMachine({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } }))).includes("powershell-5"));
  assert.ok(!idsOf(collect(winMachine())).includes("powershell-5"), "Git Bash found, the account decides: not said");
  assert.ok(!idsOf(collect(winMachine({ noGit: true, files: ["C:\\pwsh\\pwsh.exe"], env: { Path: "C:\\pwsh;C:\\Windows\\System32;C:\\Windows" } }))).includes("powershell-5"));
  assert.match(find(collect(winMachine({ noGit: true })), "powershell-5").fix, /winget install Microsoft\.PowerShell/);
});

test("wsl-bash-on-path: the WSL launcher is the bash.exe on PATH and no Git Bash is found", () => {
  const x = find(collect(winMachine({ noGit: true })), "wsl-bash-on-path");
  assert.match(x.message, /bash\.exe on PATH is the WSL launcher \(C:\\Windows\\System32\\bash\.exe\), not a Git Bash/);
  assert.ok(!idsOf(collect(winMachine())).includes("wsl-bash-on-path"), "with Git Bash found it does not matter");
});

test("claude-launcher-first, claude-not-on-path, claude-multiple, claude-older-first, claude-no-version", () => {
  const launcher = `${HOME}\\AppData\\Local\\AnthropicClaude\\claude.exe`;
  const a = collect(winMachine({ noClaude: true, files: [launcher], env: { Path: `${HOME}\\AppData\\Local\\AnthropicClaude;C:\\Windows\\System32;C:\\Windows` } }));
  assert.equal(find(a, "claude-launcher-first").severity, "warning");
  assert.match(find(a, "claude-launcher-first").message, /the Claude desktop app's launcher \(not the CLI\)/);

  const off = collect(winMachine({ files: [`${HOME}\\.local\\bin\\claude.exe`], env: { Path: "C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows" } }));
  const n = find(off, "claude-not-on-path");
  assert.match(n.message, /claude is installed \(C:\\Users\\me\\\.local\\bin\\claude\.exe, the native installer, 2\.1\.299\), but its folder is not on PATH/);
  assert.match(n.fix, /Add C:\\Users\\me\\\.local\\bin to the user PATH/);

  const npm = `${HOME}\\AppData\\Roaming\\npm\\claude.cmd`;
  const multi = collect(winMachine({ files: [npm], versions: { [npm]: "2.1.295 (Claude Code)" }, env: { Path: `${HOME}\\AppData\\Roaming\\npm;${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } }));
  assert.match(find(multi, "claude-multiple").message, /2 claude command lines are installed: .*claude\.cmd \(npm \(global\), 2\.1\.295, runs first\); .*claude\.exe \(the native installer, 2\.1\.299\)/);
  const older = find(multi, "claude-older-first");
  assert.match(older.message, /runs first on PATH is 2\.1\.295 .* is 2\.1\.299/);
  assert.match(older.fix, /Put C:\\Users\\me\\\.local\\bin before C:\\Users\\me\\AppData\\Roaming\\npm on PATH/);

  const same = collect(winMachine({ files: [npm], versions: { [npm]: "2.1.299 (Claude Code)" }, env: { Path: `${HOME}\\.local\\bin;${HOME}\\AppData\\Roaming\\npm;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } }));
  assert.ok(idsOf(same).includes("claude-multiple") && !idsOf(same).includes("claude-older-first"));

  const broken = winMachine();
  const base = broken.run;
  broken.run = (cmd, args, opts) => (cmd === NATIVE ? { status: 1, stdout: "", stderr: "bad image", error: null, timedOut: false } : base(cmd, args, opts));
  assert.match(find(collect(broken), "claude-no-version").message, /claude\.exe did not print a version \(exit 1: bad image\)/);

  const bundles = collect(winMachine({ noClaude: true, files: [`${HOME}\\AppData\\Roaming\\Claude\\claude-code\\2.1.299\\f0584be0fbaf\\claude.exe`, `${HOME}\\AppData\\Roaming\\Claude\\claude-code\\2.1.295\\d2e29494ec83\\claude.exe`] }));
  assert.deepEqual(idsOf(bundles), [], "the desktop app's own bundles are not a second install");
});

test("node-for-npm: an npm install and a Node older than 22", () => {
  const npm = `${HOME}\\AppData\\Roaming\\npm\\claude.cmd`;
  const f = collect(winMachine({ noClaude: true, files: [npm], versions: { [npm]: "2.1.299 (Claude Code)" }, nodeVersion: "v20.11.0", env: { Path: `${HOME}\\AppData\\Roaming\\npm;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } }));
  assert.match(find(f, "node-for-npm").message, /Node is 20\.11\.0, and the npm package of Claude Code wants Node 22 or later/);
  const new22 = collect(winMachine({ noClaude: true, files: [npm], versions: { [npm]: "2.1.299 (Claude Code)" }, nodeVersion: "v22.1.0", env: { Path: `${HOME}\\AppData\\Roaming\\npm;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } }));
  assert.ok(!idsOf(new22).includes("node-for-npm"));
  assert.ok(!idsOf(collect(winMachine({ nodeVersion: "v18.0.0" }))).includes("node-for-npm"), "the native install does not need Node");
});

test("long-paths, autocrlf, execution-policy, code-page, index-lock", () => {
  const key = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem";
  const lp = collect(winMachine({ registry: { [key]: { LongPathsEnabled: ["REG_DWORD", "0x0"] } }, commands: { git: (args) => (args[0] === "--version" ? out("git version 2.5\n") : { status: 1, stdout: "", stderr: "" }) } }));
  assert.match(find(lp, "long-paths").message, /Windows' LongPathsEnabled is off and git's core\.longpaths is not set/);
  assert.match(find(lp, "long-paths").fix, /reg add HKLM.*LongPathsEnabled.*git config --global core\.longpaths true/);
  const gitOnly = collect(winMachine({ commands: { git: (args) => (args[0] === "--version" ? out("git version 2.5\n") : args.at(-1) === "core.longpaths" ? out("file:x\tfalse\n") : { status: 1, stdout: "", stderr: "" }) } }));
  assert.match(find(gitOnly, "long-paths").message, /git's core\.longpaths is false/);
  assert.ok(!idsOf(collect(winMachine())).includes("long-paths"));

  const crlf = collect(winMachine({ commands: { git: (args) => (args[0] === "--version" ? out("git version 2.5\n") : args.at(-1) === "core.autocrlf" ? out("file:E:/Das/Git/etc/gitconfig\ttrue\n") : args.at(-1) === "core.longpaths" ? out("file:x\ttrue\n") : { status: 1, stdout: "", stderr: "" }) } }));
  assert.match(find(crlf, "autocrlf").message, /core\.autocrlf is true \(E:\/Das\/Git\/etc\/gitconfig\)/);
  assert.match(find(crlf, "autocrlf").effect, /wrote a new file with LF only and its Edit tool kept the CRLF/);

  const gp = collect(winMachine({ commands: { powershell: () => out(POLICY({ machine: "AllSigned" })) } }));
  const x = find(gp, "execution-policy");
  assert.match(x.message, /AllSigned \(MachinePolicy, set by Group Policy\)/);
  assert.match(x.effect, /Group Policy still wins over it/);
  const respect = collect(winMachine({ env: { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "1" }, commands: { powershell: () => out(POLICY({ currentUser: "Undefined" })) } }));
  assert.match(find(respect, "execution-policy").message, /Restricted \(default\)/);
  assert.match(find(respect, "execution-policy").effect, /RESPECT_EXECUTION_POLICY is on/);
  const respectUser = collect(winMachine({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "true" } }) }, commands: { powershell: () => out(POLICY({ currentUser: "AllSigned" })) } }));
  assert.ok(idsOf(respectUser).includes("execution-policy"), "the variable counts from the user settings too");
  assert.ok(!idsOf(collect(winMachine({ commands: { powershell: () => out(POLICY({ currentUser: "Restricted" })) } }))).includes("execution-policy"), "a restrictive CurrentUser policy is bypassed by Claude Code");

  const cp = collect(winMachine({ commands: { cmd: (args) => (/chcp/.test(args.at(-1)) ? out("Active code page: 437\r\n") : /prefix/.test(args.at(-1)) ? out("C:\\npm\r\n") : out("10.9.0\r\n")) } }));
  assert.match(find(cp, "code-page").message, /code page is 437 \(the system's OEM code page is 437\), not UTF-8/);
  assert.match(find(cp, "code-page").effect, /caf\?-\?ber\.txt/);
  assert.ok(!idsOf(collect(winMachine({ noGit: true, commands: { cmd: (args) => (/chcp/.test(args.at(-1)) ? out("Active code page: 437\r\n") : out("10.9.0\r\n")) } }))).includes("code-page"), "no Bash tool: nothing to garble");

  const lock = collect(winMachine({ dirs: [`${PROJECT}\\.git`], files: [`${PROJECT}\\.git\\index.lock`], mtimes: { [`${PROJECT}\\.git\\index.lock`]: Date.parse("2026-10-16T09:00:00Z") } }));
  assert.match(find(lock, "index-lock").message, /index\.lock exists \(3 hours old\) and no git process is running/);
  assert.ok(!idsOf(collect(winMachine({ dirs: [`${PROJECT}\\.git`], files: [`${PROJECT}\\.git\\index.lock`], commands: { tasklist: () => out("git.exe 123 Console 1 1 K\r\n") } }))).includes("index-lock"), "git is running: the lock is its own");
});

test("the user environment: set there and not here, different, and set here only for a configuration variable", () => {
  const userOnly = collect(winMachine({ registry: { "HKCU\\Environment": { CLAUDE_CONFIG_DIR: ["REG_SZ", "D:\\cfg"], ANTHROPIC_API_KEY: ["REG_SZ", "sk-ant-api-secret"] } } }));
  const a = userOnly.findings.filter((x) => x.id === "user-env-not-in-process");
  assert.equal(a.length, 2);
  assert.ok(a.some((x) => /^CLAUDE_CONFIG_DIR \(D:\\cfg\) is set in the Windows user environment, but not in this process/.test(x.message)));
  assert.ok(a.some((x) => /^ANTHROPIC_API_KEY is set in the Windows user environment/.test(x.message)));
  assert.ok(!JSON.stringify(userOnly.findings).includes("sk-ant-api-secret"), "a token is never in a finding");
  const differs = collect(winMachine({ env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" }, registry: { "HKCU\\Environment": { CLAUDE_CODE_GIT_BASH_PATH: ["REG_SZ", "D:\\other\\bash.exe"] } } }));
  assert.match(find(differs, "user-env-differs").message, /CLAUDE_CODE_GIT_BASH_PATH is not the same in the Windows user environment \(D:\\other\\bash\.exe\) and in this process \(C:\\Program Files\\Git\\bin\\bash\.exe\)/);
  const procOnly = collect(winMachine({ noGit: true, files: E_GIT, registry: REG_GIT, env: { CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\bash.exe", ANTHROPIC_MODEL: "sonnet" } }));
  const p = procOnly.findings.filter((x) => x.id === "process-env-not-in-user");
  assert.equal(p.length, 1, "only the configuration names");
  assert.match(p[0].fix, /fix --git-bash sets it for every program/);
  assert.ok(!idsOf(collect(winMachine({ env: { CLAUDE_EFFORT: "high" } }))).includes("process-env-not-in-user"));
});

test("WSL seen from Windows: only the distributions of other tools, and a managed policy that WSL inherits", () => {
  const docker = collect(winMachine({ commands: { wsl: () => ({ status: 0, stdout: utf16("  NAME STATE VERSION\r\n* docker-desktop Running 2\r\n") }) } }));
  assert.match(find(docker, "wsl-no-distro").message, /only distributions that other tools made for themselves \(docker-desktop; the default is docker-desktop\)/);
  assert.ok(!idsOf(collect(winMachine())).includes("wsl-no-distro"));
  const inherits = collect(winMachine({ texts: { "C:\\Program Files\\ClaudeCode\\managed-settings.json": JSON.stringify({ env: { A: "1" }, wslInheritsWindowsSettings: true }) } }));
  assert.match(find(inherits, "wsl-inherits-windows").message, /wslInheritsWindowsSettings is on \(managed-settings\.json\)/);
  assert.equal(find(inherits, "wsl-inherits-windows").severity, "note");
});

test("findings are sorted errors first, and counted", () => {
  const f = collect(winMachine({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }));
  const order = f.findings.map((x) => x.severity);
  assert.deepEqual(order, [...order].sort((a, b) => ({ error: 0, warning: 1, note: 2 })[a] - ({ error: 0, warning: 1, note: 2 })[b]));
  assert.equal(f.counts.error, 1);
});

test("inside WSL: a Windows claude, the config folder or the project on a Windows drive, and the Windows policy", () => {
  const wsl = (o = {}) => fakeMachine({
    platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin", ...(o.env || {}) }, home: "/home/me", cwd: "/home/me/code",
    files: ["/mnt/c/Users/me/.local/bin/claude", ...(o.files || [])],
    texts: { "/proc/version": "Linux version 5.15.153.1-microsoft-standard-WSL2", ...(o.texts || {}) },
    versions: { "/mnt/c/Users/me/.local/bin/claude": "2.1.299 (Claude Code)", ...(o.versions || {}) },
  });
  const a = collectWsl(wsl(), { project: "/home/me/code", dir: "/tmp/cwd-x" });
  assert.equal(a.kind, "wsl");
  assert.equal(a.system.wsl, 2);
  assert.match(a.findings.find((x) => x.id === "wsl-windows-claude").message, /a Windows program: \/mnt\/c\/Users\/me\/\.local\/bin\/claude/);
  const mnt = collectWsl(wsl({ env: { CLAUDE_CONFIG_DIR: "/mnt/c/Users/me/.claude" } }), { project: "/home/me/code", dir: "/tmp/cwd-x" });
  assert.match(mnt.findings.find((x) => x.id === "wsl-config-on-mnt").message, /config folder is on a Windows drive \(\/mnt\/c\/Users\/me\/\.claude, from CLAUDE_CONFIG_DIR\)/);
  const proj = collectWsl(wsl(), { project: "/mnt/c/src/shop", dir: "/tmp/cwd-x" });
  assert.match(proj.findings.find((x) => x.id === "wsl-config-on-mnt").message, /project is on a Windows drive \(\/mnt\/c\/src\/shop\)/);
  const inherit = collectWsl(wsl({ texts: { "/mnt/c/Program Files/ClaudeCode/managed-settings.json": JSON.stringify({ wslInheritsWindowsSettings: true }) } }), { project: "/home/me/code", dir: "/tmp/cwd-x" });
  assert.ok(inherit.findings.some((x) => x.id === "wsl-inherits-windows"));
  const clean = collectWsl(wsl({ env: { PATH: "/home/me/.local/bin:/usr/bin" }, files: ["/home/me/.local/bin/claude"], versions: { "/home/me/.local/bin/claude": "2.1.299 (Claude Code)" } }), { project: "/home/me/code", dir: "/tmp/cwd-x" });
  assert.deepEqual(clean.findings, []);
});
