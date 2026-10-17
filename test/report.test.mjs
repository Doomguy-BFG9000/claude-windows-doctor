// The reports: text, the short markdown of the skill, and JSON. No secret in any of them, the caps, the shape of the documents.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { HOME, PROJECT, collect, winMachine } from "./win-machine.mjs";
import { collectWsl, notApplicable } from "../src/check.mjs";
import { checkJson, checkMarkdown, checkText, explainListJson, explainListText, explainText, fixJson, fixText } from "../src/report.mjs";
import { listPages, pageFor } from "../src/explain.mjs";

const SECRET = "sk-ant-api03-SECRET-VALUE-0123456789";
const E_GIT = ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe"];
const spoiled = () => winMachine({
  noGit: true, files: E_GIT, registry: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "E:\\Das\\Git"] }, "HKCU\\Environment": { ANTHROPIC_API_KEY: ["REG_SZ", `${SECRET}-USER`], CLAUDE_CONFIG_DIR: ["REG_SZ", "D:\\cfg"], ANTHROPIC_AUTH_TOKEN: ["REG_SZ", "tok-user"] } },
  env: { Path: `${HOME}\\.local\\bin;E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows`, ANTHROPIC_API_KEY: `${SECRET}-PROCESS`, ANTHROPIC_AUTH_TOKEN: "tok-proc", CLAUDE_CODE_OAUTH_TOKEN: "oauth-proc", ANTHROPIC_BASE_URL: "https://gateway.example/v1", CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" },
  texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { ANTHROPIC_API_KEY: "sk-from-settings", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, defaultShell: "powershell" }) },
});

test("the explain list is aligned text and a JSON document with every id and title", () => {
  const pages = listPages();
  const lines = explainListText(pages).trimEnd().split("\n");
  const width = Math.max(...pages.map((p) => p.id.length));
  assert.deepEqual(lines, pages.map((p) => `${p.id.padEnd(width)}   ${p.title}`));
  assert.deepEqual(explainListJson(pages), { ok: true, findings: pages });
});

test("no secret is in the text, the markdown or the JSON: a token in the environment, in the registry or in a settings file is set, never its value", () => {
  const f = collect(spoiled());
  for (const form of [checkText(f), checkMarkdown(f), JSON.stringify(checkJson(f))]) {
    for (const secret of [SECRET, "tok-user", "tok-proc", "oauth-proc", "sk-from-settings", "gateway.example"]) assert.ok(!form.includes(secret), `${secret} is not in the report`);
  }
  assert.match(checkText(f), /ANTHROPIC_API_KEY {15,}user: set {5,}this process: set {3}\(differs\)/);
  const names = checkJson(f).userEnv.entries.map((e) => e.name);
  assert.ok(names.includes("ANTHROPIC_API_KEY") && names.includes("CLAUDE_CONFIG_DIR"));
  assert.deepEqual(checkJson(f).userEnv.entries.find((e) => e.name === "ANTHROPIC_API_KEY").user, { set: true, type: "REG_SZ" });
});

test("the text report: its sections, in order, and the steps of the Git Bash search as Claude Code takes them", () => {
  const t = checkText(collect(spoiled()));
  const order = ["The shell the model gets", "claude on this machine", "The rest of the setup", "User environment (HKCU\\Environment) against this process", "WSL", "Settings files read:", "Findings"];
  let at = -1;
  for (const h of order) { const i = t.indexOf(`\n${h}`); assert.ok(i > at, `${h} comes after the one before it`); at = i; }
  assert.match(t, /    1 {2}CLAUDE_CODE_GIT_BASH_PATH: not set\n    2 {2}C:\\Program Files\\Git\\bin\\bash\.exe: not there\n {7}C:\\Program Files \(x86\)\\Git\\bin\\bash\.exe: not there\n    3 {2}where git: E:\\Das\\Git\\mingw64\\bin\\git\.exe is the first line \(of 2\); two folders up, E:\\Das\\Git\\mingw64\\bin\\bash\.exe: not there\n/);
  assert.match(t, /Git Bash files on this machine: E:\\Das\\Git\\bin\\bash\.exe/);
  assert.match(t, /PowerShell tool {3}yes \(.*\)/);
  assert.match(t, /defaultShell {6}"powershell" \(~\\\.claude\\settings\.json\): the shell for the commands you type after !, not the model's tool/);
  assert.match(t, /\n {2}note {4}default-shell-scope\n/);
});

test("with a variable that works, the first step says used; with one that does not, why", () => {
  const ok = checkText(collect(winMachine({ env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" } })));
  assert.match(ok, /CLAUDE_CODE_GIT_BASH_PATH: C:\\Program Files\\Git\\bin\\bash\.exe \(the process environment\): used/);
  assert.match(ok, /Bash tool {9}yes: Git Bash at C:\\Program Files\\Git\\bin\\bash\.exe \(from CLAUDE_CODE_GIT_BASH_PATH, the process environment\)/);
  const bad = checkText(collect(winMachine({ env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\cmd\\git.exe" } })));
  assert.match(bad, /\(the process environment\): ignored: not named bash\.exe, sh\.exe, bash or sh/);
});

test("the markdown: a header, a line of the facts, a line of the shell, then the errors and warnings, 500 characters a line at most", () => {
  const f = collect(spoiled());
  const lines = checkMarkdown(f).trimEnd().split("\n");
  assert.equal(lines[0], `## windows-doctor check: ${PROJECT}`);
  assert.match(lines[1], /^Windows 11 Pro; claude 2\.1\.299 runs first from C:\\Users\\me\\\.local\\bin\\claude\.exe\.$/);
  assert.match(lines[2], /^Shell: Bash tool no, Git Bash not found; PowerShell tool yes\. 0 errors, 4 warnings, \d notes?\.$/);
  assert.match(lines[3], /^- WARNING `git-bash-not-found`: Git for Windows is installed \(E:\\Das\\Git\\bin\\bash\.exe\)/);
  assert.deepEqual(lines.filter((l) => l.startsWith("- ")).map((l) => /`([a-z-]+)`/.exec(l)[1]), ["git-bash-not-found", "user-env-differs", "user-env-differs", "user-env-not-in-process"], "warnings only: the notes are counted, not listed");
  for (const l of lines) assert.ok(l.length <= 500, `${l.length} characters`);
  const clean = checkMarkdown(collect(winMachine()));
  assert.match(clean, /Shell: Bash tool yes, Git Bash at C:\\Program Files\\Git\\bin\\bash\.exe \(the fixed path C:\\Program Files\\Git\); PowerShell tool decided by the account\./);
  assert.match(clean, /No findings\.\n$/);
  const none = checkMarkdown(collect(winMachine({ noClaude: true })));
  assert.match(none, /no claude on PATH\./);
});

test("a line of the markdown: message, then what Claude Code does when there is room, then the fix; a message too long to fit is cut and the fix stays whole", () => {
  const base = collect(winMachine());
  const md = (findings) => checkMarkdown({ ...base, findings, counts: { error: 0, warning: findings.length, note: 0 } }).trimEnd().split("\n").slice(3);
  const [short] = md([{ id: "a-b", severity: "warning", message: "It is wrong.", effect: "Claude Code does X.", fix: "Do Y." }]);
  assert.equal(short, "- WARNING `a-b`: It is wrong. Effect: Claude Code does X. Fix: Do Y.");
  const [noRoom] = md([{ id: "a-b", severity: "warning", message: "m".repeat(300), effect: "e".repeat(300), fix: "Do Y." }]);
  assert.equal(noRoom, `- WARNING \`a-b\`: ${"m".repeat(300)} Fix: Do Y.`, "the effect is left out when the line would be too long");
  const [cut] = md([{ id: "a-b", severity: "warning", message: "m".repeat(900), effect: "e", fix: "Run claude-windows-doctor fix --git-bash." }]);
  assert.ok(cut.length <= 500, `${cut.length} characters`);
  assert.ok(cut.endsWith("… Fix: Run claude-windows-doctor fix --git-bash."), "the fix is whole");
  const [words] = md([{ id: "a-b", severity: "warning", message: "word ".repeat(200), effect: null, fix: "Do Y." }]);
  assert.ok(words.length <= 500 && words.endsWith("word… Fix: Do Y."), "a message is cut at a space, not in the middle of a word");
  const [noFix] = md([{ id: "a-b", severity: "warning", message: "It is wrong.", effect: null, fix: null }]);
  assert.equal(noFix, "- WARNING `a-b`: It is wrong.");
  const [huge] = md([{ id: "a-b", severity: "warning", message: "m", effect: null, fix: "f".repeat(900) }]);
  assert.ok(huge.length <= 500 && huge.endsWith("…"), "a fix longer than a line is cut with the rest");
});

test("the markdown with notes only says how many are not shown", () => {
  const f = collect(winMachine({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "powershell" }) } }));
  assert.match(checkMarkdown(f), /- 1 note not shown \(run `claude-windows-doctor check`\)\n$/);
});

test("the JSON document of check on Windows has these fields, and a finding has these", () => {
  const f = collect(spoiled());
  const j = checkJson(f);
  assert.deepEqual(Object.keys(j), ["ok", "applicable", "platform", "kind", "project", "system", "shell", "binaries", "settings", "machine", "userEnv", "wsl", "findings", "counts"]);
  assert.deepEqual(Object.keys(j.shell), ["tools", "fatal", "gitBash", "powershell", "deny", "defaultShell", "why"]);
  assert.deepEqual(Object.keys(j.shell.gitBash), ["found", "path", "how", "variable", "variableState", "trail", "starts", "onMachine"]);
  assert.deepEqual(Object.keys(j.shell.powershell), ["setting", "state", "why", "unread", "variable", "edition", "path", "how"]);
  assert.deepEqual(Object.keys(j.machine), ["node", "longPaths", "git", "executionPolicy", "codePage", "indexLock"]);
  assert.deepEqual(Object.keys(j.findings[0]), ["id", "severity", "message", "effect", "fix"]);
  assert.deepEqual(Object.keys(j.binaries), ["first", "entries"]);
  assert.deepEqual(Object.keys(j.binaries.entries[0]), ["path", "origin", "onPath", "runsFirst", "version", "note", "skipped"]);
  assert.deepEqual(j.shell.tools, { Bash: false, PowerShell: "yes" });
  assert.equal(j.shell.gitBash.variableState, "unset");
  assert.equal(JSON.parse(JSON.stringify(j)).shell.gitBash.found, false, "it survives a round trip through JSON");
  assert.deepEqual(Object.keys(checkJson({ ...f, live: { ok: true, claude: { path: "x", version: "1" }, proved: true, predicted: { tools: [], exit: 0, bash: null, how: null }, actual: { tools: [], exit: 0, bash: null }, differences: [], run: { edition: null, warning: null, exitCode: 0, requests: 1 } } })).slice(-3), ["live", "findings", "counts"]);
});

test("the live part of the report: proved, with what the binary took and the PowerShell edition; a difference; a run that could not be made", () => {
  const f = collect(winMachine());
  const live = (o) => ({ ok: true, claude: { path: "C:\\c\\claude.exe", version: "2.1.299" }, proved: true, predicted: { tools: ["Bash"], exit: 0, bash: "C:\\Program Files\\Git\\bin\\bash.exe", how: "program-files" }, actual: { tools: ["Bash"], exit: 0, bash: "C:\\Program Files\\Git\\bin\\bash.exe" }, differences: [], run: { exitCode: 0, stderr: "", edition: null, warning: null, requests: 1 }, ...o });
  const a = checkText({ ...f, live: live({}) });
  assert.match(a, /live {14}proved with the real claude 2\.1\.299 \(C:\\c\\claude\.exe\), through a fake API on 127\.0\.0\.1 \(no token spent\):/);
  assert.match(a, /the first request listed Bash, and it took C:\\Program Files\\Git\\bin\\bash\.exe/);
  assert.match(a, /the fake API has no account, so the account's default for the PowerShell tool is off there; predicted: Bash/);
  const b = checkText({ ...f, live: live({ proved: false, differences: ["the binary listed PowerShell; the prediction was Bash"], actual: { tools: ["PowerShell"], exit: 0, bash: null } }) });
  assert.match(b, /DID NOT MATCH/);
  assert.match(b, /difference: the binary listed PowerShell; the prediction was Bash/);
  assert.match(checkText({ ...f, live: { ok: false, error: "no claude on PATH to run (pass --claude <path>)" } }), /live {14}not run: no claude on PATH to run/);
  const stop = checkText({ ...f, live: live({ actual: { tools: [], exit: 1, bash: null }, run: { exitCode: 1, stderr: "Claude Code on Windows requires a shell tool.", edition: null, warning: null, requests: 0 } }) });
  assert.match(stop, /listed no shell tool \(it exited with code 1: Claude Code on Windows requires a shell tool\.\)/);
  assert.equal(checkJson({ ...f, live: { ok: false, error: "x" } }).live.ok, false);
});

test("WSL's report and markdown, and the nothing-to-check report", () => {
  const sys = fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", cwd: "/home/me/code", files: ["/mnt/c/Users/me/.local/bin/claude"], texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" }, versions: { "/mnt/c/Users/me/.local/bin/claude": "2.1.299 (Claude Code)" } });
  const f = collectWsl(sys, { project: "/home/me/code", dir: "/tmp/cwd-x" });
  const t = checkText(f);
  assert.match(t, /the WSL side of Claude Code/);
  assert.match(t, /1 {2}\/mnt\/c\/Users\/me\/\.local\/bin\/claude {3}2\.1\.299 {3}a Windows program reached through WSL; runs first/);
  assert.match(t, /config folder {3}\/home\/me\/\.claude \(default\)/);
  assert.match(checkMarkdown(f), /^## windows-doctor check \(WSL\): \/home\/me\/code\nclaude runs from \/mnt\/c\/Users\/me\/\.local\/bin\/claude \(2\.1\.299\)\. 0 errors, 1 warning, 0 notes\.\n- WARNING `wsl-windows-claude`/);
  assert.deepEqual(Object.keys(checkJson(f)), ["ok", "applicable", "platform", "kind", "project", "system", "binaries", "locations", "wslInherits", "findings", "counts"]);
  const n = notApplicable(fakeMachine({ platform: "darwin" }));
  assert.match(checkText(n), /^claude-windows-doctor 1\.0\.0 {2}nothing to check\nNothing to check on macOS: /);
  assert.deepEqual(Object.keys(checkJson(n)), ["ok", "applicable", "platform", "kind", "system", "message", "findings", "counts"]);
});

test("fix's report, as text and JSON: set, nothing to do, refused, and an undo", () => {
  const base = { ok: true, refused: null, reason: null, dryRun: false, action: "set", name: "CLAUDE_CODE_GIT_BASH_PATH", key: "HKCU\\Environment", layer: "registry", value: "E:\\Das\\Git\\bin\\bash.exe", previous: null, via: "git.exe on PATH (x)", record: "C:\\r.json", notes: ["n1"] };
  assert.match(fixText(base, { what: "fix" }), /^Set CLAUDE_CODE_GIT_BASH_PATH=E:\\Das\\Git\\bin\\bash\.exe in the Windows user environment \(HKCU\\Environment\)\. Found by: git\.exe on PATH \(x\)\.\nThe record, for undo: C:\\r\.json\nn1\nUndo with: claude-windows-doctor undo\n$/);
  assert.match(fixText({ ...base, dryRun: true }, { what: "fix" }), /^Would set /);
  assert.match(fixText({ ...base, layer: "file", key: "C:\\f.json" }, { what: "fix" }), /\(C:\\f\.json, a file standing in for the registry\)/);
  assert.equal(fixText({ ...base, action: "nothing", notes: ["Nothing to fix."] }, { what: "fix" }), "Nothing to fix.\n");
  assert.equal(fixText({ ...base, ok: false, refused: "no." }, { what: "fix" }), "refused: no.\n");
  assert.equal(fixText({ ...base, action: "remove", notes: ["Removed."] }, { what: "undo" }), "Removed.\n");
  assert.deepEqual(Object.keys(fixJson(base)), ["ok", "refused", "reason", "dryRun", "action", "name", "key", "layer", "value", "previous", "via", "record", "notes"]);
  assert.equal(fixJson({ ...base, ok: false, refused: "no." }).refused, "no.");
  assert.equal(fixJson(base).refused, null);
});

test("plain words in the reports: no emoji, no superlatives", () => {
  const all = [checkText(collect(spoiled())), checkMarkdown(collect(spoiled())), explainText(pageFor("git-bash-not-found"))].join("\n");
  assert.ok(!/\p{Extended_Pictographic}/u.test(all));
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing)\b/i.test(all));
});
