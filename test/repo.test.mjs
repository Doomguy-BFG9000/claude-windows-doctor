// The package itself: what it says it is, what it imports, which Node it needs, that only the places that must start a program, open a
// connection or write a file do, that the plugin's skill calls the tool with options the tool has, that the icon is a real PNG of the
// right size, that no file has a carriage return, that the workflows and the README have what they promise, and that the version is
// the same everywhere.
import { ROOT, run } from "./helpers.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { HELP, parseArgs } from "../src/cli.mjs";
import { VERSION } from "../src/version.mjs";
import { IDS } from "../src/explain.mjs";
import { fakeMachine } from "./machine.mjs";
import { winMachine } from "./win-machine.mjs";
import { REAL_KEY } from "../src/winenv.mjs";

// a checkout on Windows may turn line feeds into CRLF
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const files = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(ext)).map((n) => path.join(dir, n));
const posix = (f) => f.split(path.sep).join("/");

const pkg = json("package.json");
const plugin = json(".claude-plugin/plugin.json");
const SOURCES = [...files("src", ".mjs"), ...files("bin", ".mjs")];

test("package.json: name, version, bin, engines, no dependencies, tests run with node --test, the files that are shipped", () => {
  assert.equal(pkg.name, "claude-windows-doctor");
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, { "claude-windows-doctor": "bin/claude-windows-doctor.mjs" });
  assert.equal(pkg.engines.node, ">=18");
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.scripts.test, "node --test");
  assert.deepEqual(pkg.files, ["bin", "src", ".claude-plugin", "skills", "README.md", "LICENSE"]);
  for (const f of pkg.files) assert.ok(exists(f), `${f} is listed and exists`);
  assert.match(pkg.description, /^Which shell Claude Code's Bash tool gets on Windows and why/);
  assert.match(pkg.description, /Zero tokens\.$/);
  assert.equal(pkg.repository, "github:nrzz/claude-windows-doctor");
  assert.equal(pkg.homepage, "https://nrzz.github.io/claude-code-toolkit/");
  assert.equal(pkg.bugs, "https://github.com/nrzz/claude-windows-doctor/issues");
  assert.equal(pkg.author, "Naresh Prabu");
  for (const k of ["claude", "claude-code", "anthropic", "windows", "git-bash", "powershell", "wsl", "shell", "diagnostics"]) assert.ok(pkg.keywords.includes(k), k);
});

test("no lock file, no vendored node_modules, and no .gitattributes (the plugin directory cannot validate a repository that has one)", () => {
  assert.ok(!exists("package-lock.json"));
  assert.ok(!exists("npm-shrinkwrap.json"));
  assert.ok(!exists("yarn.lock"));
  assert.ok(!exists("node_modules") || fs.readdirSync(path.join(ROOT, "node_modules")).length === 0);
  assert.ok(!exists(".gitattributes"));
  assert.match(read(".gitignore"), /^node_modules\/$/m);
});

test("no tracked text file has a carriage return: every file is written with LF (the index is read, a checkout on Windows may differ)", { skip: !exists(".git") && "not a git checkout" }, () => {
  const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer", windowsHide: true });
  assert.equal(ls.status, 0, String(ls.stderr));
  const tracked = ls.stdout.toString("utf8").split("\0").filter(Boolean);
  assert.ok(tracked.length > 20, `${tracked.length} tracked files`);
  const withCr = [];
  for (const f of tracked) {
    if (/\.(png|ico|jpg|gif|woff2?)$/i.test(f)) continue;
    const blob = spawnSync("git", ["show", `:${f}`], { cwd: ROOT, encoding: "buffer", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (blob.status === 0 && blob.stdout.includes(13)) withCr.push(f);
  }
  assert.deepEqual(withCr, [], "files that hold a carriage return in the index");
});

test("the plugin manifest matches the package, with the six links the plugin directory reads", () => {
  assert.equal(plugin.name, "windows-doctor");
  assert.equal(plugin.displayName, "Windows Doctor");
  assert.equal(plugin.version, VERSION);
  assert.equal(plugin.license, "MIT");
  assert.deepEqual(plugin.author, { name: "Naresh Prabu" });
  assert.equal(plugin.homepage, "https://github.com/nrzz/claude-windows-doctor");
  assert.equal(plugin.repository, "https://github.com/nrzz/claude-windows-doctor");
  assert.equal(plugin.documentationUrl, "https://github.com/nrzz/claude-windows-doctor#readme");
  assert.equal(plugin.supportUrl, "https://github.com/nrzz/claude-windows-doctor/issues");
  assert.equal(plugin.privacyPolicyUrl, "https://github.com/nrzz/claude-windows-doctor#privacy");
  assert.equal(plugin.termsOfServiceUrl, "https://github.com/nrzz/claude-windows-doctor/blob/main/LICENSE");
  assert.deepEqual(plugin.keywords, ["windows", "git-bash", "powershell", "wsl", "shell", "diagnostics"]);
  assert.match(plugin.description, /\/windows-doctor:check/);
  assert.equal(plugin.hooks, undefined, "no hooks: the plugin is one skill");
  assert.equal(plugin.mcpServers, undefined);
  assert.ok(!exists(".mcp.json") && !exists("hooks") && !exists("agents") && !exists("commands"));
});

test("the icon is a real PNG, 1024 by 1024, as the other plugins' are", () => {
  const png = fs.readFileSync(path.join(ROOT, ".claude-plugin", "icon.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the PNG signature");
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 1024, "width");
  assert.equal(png.readUInt32BE(20), 1024, "height");
  assert.ok(png.length > 2000 && png.length < 500000, `${png.length} bytes`);
  assert.equal(png.toString("ascii", png.length - 8, png.length - 4), "IEND");
});

test("one skill, /windows-doctor:check: user-only, a description of four words, allowed to run this tool and nothing wider", () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "skills")), ["check"]);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "skills", "check")), ["SKILL.md"]);
  const text = read("skills/check/SKILL.md");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(front, "has frontmatter");
  assert.match(front[1], /^name: check$/m);
  assert.match(front[1], /^disable-model-invocation: true$/m);
  const desc = /^description: (.+)$/m.exec(front[1])[1];
  assert.equal(desc, "Check the Windows setup.", "the hub's plugins share an always-on limit of 200 tokens");
  assert.ok(desc.length <= 30, `${desc.length} characters`);
  const allowed = /^allowed-tools: (.+)$/m.exec(front[1])[1];
  const rules = allowed.split(/\s(?=(?:Bash|PowerShell)\()/);
  assert.equal(rules.length, 4);
  for (const rule of rules) assert.match(rule, /^(Bash|PowerShell)\(node "?\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/claude-windows-doctor\.mjs"? \*\)$/, rule);
  assert.ok(rules.some((r) => r.startsWith("Bash(")) && rules.some((r) => r.startsWith("PowerShell(")), "for whichever shell tool Claude Code has: on Windows the session may have only PowerShell");
  assert.doesNotMatch(allowed, /Bash\(\*\)|Edit|Write|WebFetch/, "nothing wider than the one command");
});

test("the skill runs check --markdown for the project, once, and asks for at most 10 lines and no edit before the user agrees", () => {
  const text = read("skills/check/SKILL.md");
  const body = text.slice(/^---\n[\s\S]*?\n---\n/.exec(text)[0].length);
  const commands = [...body.matchAll(/^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/claude-windows-doctor\.mjs" (.+)`$/gm)].map((m) => m[1]);
  assert.equal(commands.length, 1, "one command line, which Claude Code runs or hands to the model");
  const parsed = parseArgs(commands[0].replace(/"\$\{CLAUDE_PROJECT_DIR\}"/g, "dir").split(/\s+/));
  assert.equal(parsed.command, "check");
  assert.equal(parsed.markdown, true);
  assert.equal(parsed.live, false, "the skill never starts the real binary");
  assert.equal(parsed.project, "dir");
  assert.match(body, /At most 10 lines: the shell the Bash tool gets and why in one line, then each problem with its fix\./);
  assert.match(body, /If there are no findings, say so in one line\./);
  assert.match(body, /Edit nothing until the user agrees\./);
  assert.ok(!/\$\{CLAUDE_SKILL_DIR\}|\$ARGUMENTS/.test(body));
  assert.ok(body.length < 700, `the instructions are ${body.length} characters; each use pays for them`);
});

test("every source file is .mjs and imports only node built-ins and the package itself", () => {
  assert.ok(SOURCES.length >= 20);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "src")).filter((n) => !n.endsWith(".mjs")), []);
  const allowed = new Set(["node:child_process", "node:fs", "node:http", "node:os", "node:path"]);
  for (const f of SOURCES) {
    const text = read(f);
    for (const m of text.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)) {
      const spec = m[1];
      assert.ok(spec.startsWith("./") || spec.startsWith("../") || allowed.has(spec), `${f} imports ${spec}`);
    }
    assert.doesNotMatch(text, /\brequire\(|\bimport\(/, `${f} has no dynamic loading`);
  }
});

test("only src/sys.mjs and src/live.mjs start a program, only src/live.mjs opens a connection (to 127.0.0.1), and nothing can run code that was not written here", () => {
  const startsProcess = /node:child_process|(?<![.\w])(spawn|spawnSync|execSync|execFile|execFileSync|fork)\s*\(/;
  const opensConnection = /node:(http|https|http2|net|tls|dns|dgram)\b|(?<![.\w])(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/;
  const runsCode = /node:(worker_threads|cluster|vm)\b|\bprocess\.binding\b|\beval\s*\(|new Function\s*\(/;
  for (const f of SOURCES) {
    const name = posix(f);
    const text = read(f);
    if (name !== "src/sys.mjs" && name !== "src/live.mjs") assert.doesNotMatch(text, startsProcess, `${name} must not start a program: only src/sys.mjs and src/live.mjs do`);
    if (name !== "src/live.mjs") assert.doesNotMatch(text, opensConnection, `${name} must not open a connection: only src/live.mjs does`);
    assert.doesNotMatch(text, runsCode, name);
  }
  const live = read("src/live.mjs");
  assert.match(live, /node:http/);
  assert.match(live, /server\.listen\(0, "127\.0\.0\.1"/, "the fake API listens on the loopback address only");
  assert.doesNotMatch(live, /http\.(request|get)\(|https?:\/\/(?!127\.0\.0\.1|\$\{)/, "live.mjs makes no request of its own and names no other host");
  assert.match(read("src/sys.mjs"), /node:child_process/);
  assert.doesNotMatch(read("src/sys.mjs"), /node:(http|https|net)/);
});

test("only src/sys.mjs and src/write.mjs touch the file system, and src/write.mjs is the only code that writes: nothing else calls a function that changes a file", () => {
  const writes = /\b(?:writeFile|appendFile|copyFile|rename|unlink|rmdir|rm|mkdir|mkdtemp|truncate|symlink|link|chmod|utimes)(?:Sync)?\s*\(|\bcreateWriteStream\b|\bfs\.promises\b/;
  for (const f of SOURCES) {
    const name = posix(f);
    const text = read(f);
    if (name !== "src/write.mjs") assert.doesNotMatch(text, writes, `${f} must not write: only src/write.mjs does`);
    if (name !== "src/sys.mjs" && name !== "src/write.mjs") assert.doesNotMatch(text, /node:fs/, `${f} must read through sys: only src/sys.mjs and src/write.mjs import node:fs`);
  }
  const w = read("src/write.mjs");
  assert.match(w, /fs\.writeFileSync/);
  assert.match(w, /fs\.renameSync/, "the record is written through a temporary file and a rename");
  assert.doesNotMatch(read("src/sys.mjs"), /writeFile|appendFile|mkdir|rmSync|unlink/, "sys.mjs reads");
});

test("the registry is written in one place only: src/winenv.mjs, through reg add and reg delete of one key (HKCU\\Environment), and setx for the notification", () => {
  for (const f of SOURCES) {
    const name = posix(f);
    if (name === "src/winenv.mjs") continue;
    assert.doesNotMatch(read(f), /\brun\(\s*["'`](?:reg|reg\.exe|setx|setx\.exe)["'`]/i, `${name} starts reg or setx: only src/winenv.mjs does`);
  }
  const text = read("src/winenv.mjs");
  const calls = [...text.matchAll(/sys\.run\("(reg|setx)", \["([a-z]+|[A-Z_]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(calls, ["reg add", "reg delete", "setx CLAUDE_WINDOWS_DOCTOR_NOTIFY", "reg delete"], "reg add (set), reg delete (remove), then the throwaway name of the notification: setx and reg delete");
  assert.match(text, /REAL_KEY = "HKCU\\\\Environment"/);
  assert.equal([...text.matchAll(/REAL_KEY/g)].length >= 4, true, "every write names the one key");
  assert.doesNotMatch(text, /HKLM[^\n]*sys\.run\("reg", \["(add|delete)"/, "nothing machine-wide is written");
});

test("Windows paths are handled with path.win32 and the helpers of src/winpath.mjs only: no path.resolve and no process.cwd in the Windows logic", () => {
  const windowsLogic = ["shell.mjs", "gitbash.mjs", "binaries.mjs", "settings.mjs", "facts.mjs", "wsl.mjs", "userenv.mjs", "fix.mjs"];
  for (const f of windowsLogic) {
    const text = read(`src/${f}`);
    assert.doesNotMatch(text, /path\.resolve\(|process\.cwd\(|os\.homedir\(/, `${f} must ask sys for the working folder and the home folder, and must not use the host's path.resolve`);
  }
});

test("only APIs that exist in Node 18 are used", () => {
  const newer = [
    [/\.toSorted\(|\.toReversed\(|\.toSpliced\(|\.with\(\d/, "Array copy-methods (Node 20)"],
    [/\bObject\.groupBy\b|\bMap\.groupBy\b/, "groupBy (Node 21)"],
    [/\bArray\.fromAsync\b/, "Array.fromAsync (Node 22)"],
    [/\bPromise\.withResolvers\b/, "Promise.withResolvers (Node 22)"],
    [/import\.meta\.(dirname|filename)\b/, "import.meta.dirname/filename (Node 20.11)"],
    [/\bfs\.(glob|globSync)\b/, "fs.glob (Node 22)"],
    [/\.(isWellFormed|toWellFormed)\(/, "String well-formed methods (Node 20)"],
    [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, "Set methods (Node 22)"],
    [/process\.getBuiltinModule|process\.loadEnvFile|util\.styleText|\bstyleText\b/, "newer process/util APIs"],
    [/\bimport\s[^;]*\swith\s*\{/, "import attributes"],
    [/\bfs\.cpSync\b/, "fs.cpSync is experimental before Node 22"],
  ];
  for (const f of SOURCES) {
    const text = read(f);
    for (const [re, what] of newer) assert.doesNotMatch(text, re, `${f}: ${what}`);
  }
});

test("the licence, the conduct file, the changelog and the version agree", () => {
  assert.match(read("LICENSE"), /^MIT License/);
  assert.match(read("LICENSE"), /Copyright \(c\) 2026 Naresh Prabu/);
  assert.ok(exists("CODE_OF_CONDUCT.md"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^## \\[${VERSION.replace(/\./g, "\\.")}\\] - 2026-10-16$`, "m"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^\\[${VERSION.replace(/\./g, "\\.")}\\]: https://github\\.com/nrzz/claude-windows-doctor/releases/tag/v${VERSION.replace(/\./g, "\\.")}$`, "m"));
  for (const f of ["SECURITY.md", "SUPPORT.md", "ROADMAP.md", "CONTRIBUTING.md"]) assert.ok(exists(f), f);
  assert.match(read("SECURITY.md"), /security\/advisories\/new/);
  const roadmap = read("ROADMAP.md");
  assert.ok((roadmap.match(/^- /gm) || []).length >= 3 && (roadmap.match(/^- /gm) || []).length <= 5, "three to five next steps");
  assert.match(read("CONTRIBUTING.md"), /## Where things are/);
});

test("the issue forms and the pull request template are there", () => {
  for (const f of ["bug_report.yml", "feature_request.yml", "config.yml"]) assert.ok(exists(`.github/ISSUE_TEMPLATE/${f}`), f);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /blank_issues_enabled: false/);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /nrzz\/claude-windows-doctor\/discussions/);
  assert.ok(exists(".github/PULL_REQUEST_TEMPLATE.md"));
  assert.match(read(".github/dependabot.yml"), /package-ecosystem: github-actions/);
  for (const f of ["bug_report.yml", "feature_request.yml"]) assert.match(read(`.github/ISSUE_TEMPLATE/${f}`), /claude-windows-doctor/);
});

test("the CI workflows: the suite on three systems and four Node versions, and the real-binary checks on all three systems, with no action version pinned here", () => {
  const ci = read(".github/workflows/test.yml");
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /node: \[20, 22, 24\]/);
  assert.match(ci, /node: 18/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /uses: actions\/checkout@/);
  assert.match(ci, /uses: actions\/setup-node@/);
  assert.match(ci, /timeout-minutes: \d+/);
  const e2e = read(".github/workflows/e2e.yml");
  for (const part of ["name: e2e", "ubuntu-latest, macos-latest, windows-latest", "npm install -g @anthropic-ai/claude-code", "continue-on-error: true", "E2E_CLAUDE: claude", "schedule:", "workflow_dispatch", "--test-concurrency=1"]) assert.ok(e2e.includes(part), part);
  for (const file of ["e2e-shell", "e2e-platform", "windows", "e2e-live", "e2e-plugin"]) assert.ok(e2e.includes(`test/${file}.test.mjs`), file);
  assert.match(e2e, /timeout-minutes: \d+/);
  // the install may fail without failing the job; the real-binary checks may not
  const steps = e2e.split(/\n {6}- /);
  const install = steps.find((s) => s.includes("npm install -g"));
  const binary = steps.find((s) => s.includes("test/e2e-shell.test.mjs"));
  assert.match(install, /continue-on-error: true/);
  assert.doesNotMatch(binary, /continue-on-error/);
  // every real-binary file that the workflow runs is a file
  for (const m of e2e.matchAll(/test\/[\w.-]+\.test\.mjs/g)) assert.ok(exists(m[0]), m[0]);
});

const README_SECTIONS = ["## What you get", "## What it costs in tokens", "## Install", "## Use", "## How it works", "## What was verified, and how", "## Not verified", "## Files", "## Contributing", "## Part of the Claude Code toolkit", "## License"];
const TOOLKIT = [
  "- [claude-code-handover](https://github.com/nrzz/claude-code-handover): short sessions with a handover file every new session loads by itself",
  "- [claude-code-team-sync](https://github.com/nrzz/claude-code-team-sync): share sessions, notes and team context with coworkers",
  "- [claude-code-glow](https://github.com/nrzz/claude-code-glow): themes for the whole interface, a status line and a live HUD",
  "- [claude-code-guardrails](https://github.com/nrzz/claude-code-guardrails): safety presets that stop risky commands and edits",
  "- [claude-code-notify](https://github.com/nrzz/claude-code-notify): a ping when Claude needs you or finishes",
  "- [claude-cost-guard](https://github.com/nrzz/claude-cost-guard): daily and weekly token budgets with zero-token warnings",
  "- [claude-md-doctor](https://github.com/nrzz/claude-md-doctor): what your CLAUDE.md costs every session, and how to slim it",
  "- [claude-code-starter-kits](https://github.com/nrzz/claude-code-starter-kits): a lean, safe .claude/ for your stack in one command",
  "- [claude-session-replay](https://github.com/nrzz/claude-session-replay): search past sessions and export one as an HTML replay",
  "- [claude-chat-ferry](https://github.com/nrzz/claude-chat-ferry): continue a Cursor or Antigravity chat in Claude Code, or hand a session to them",
  "- [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor): why a permission prompt appeared, dead rules, rules from your history",
  "- [claude-session-tidy](https://github.com/nrzz/claude-session-tidy): list, delete, keep and restore your sessions before the 30-day sweep",
  "- [claude-hook-bench](https://github.com/nrzz/claude-hook-bench): run every hook with the JSON Claude Code sends, and see what each one does",
  "- [claude-relocate](https://github.com/nrzz/claude-relocate): move Claude Code's config folder to another drive or the XDG folders, safely, with undo",
  "- [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor): a commented settings.jsonc that builds settings.json, the merged settings with their source, a lint against the schema",
  "- [claude-automode-doctor](https://github.com/nrzz/claude-automode-doctor): what auto mode and its classifier decided, from your transcripts, plus a lint of the autoMode settings",
  "- [claude-mcp-check](https://github.com/nrzz/claude-mcp-check): every MCP server Claude Code would load, from which file, whether it starts, and what its tools cost",
  "- [claude-sandbox-doctor](https://github.com/nrzz/claude-sandbox-doctor): whether Claude Code's Bash sandbox works on this machine, and why a command ran inside it, outside it, or not at all",
];

test("the README has the sections the house keeps, in order, and the Privacy heading the plugin manifest links to", () => {
  const readme = read("README.md");
  let at = -1;
  for (const h of README_SECTIONS) {
    const i = readme.indexOf(`\n${h}\n`);
    assert.ok(i > at, `${h} is there, after the one before it`);
    at = i;
  }
  assert.match(readme, /^# claude-windows-doctor\n/);
  assert.ok(readme.indexOf("\n### Privacy\n") > readme.indexOf("\n## How it works\n") && readme.indexOf("\n### Privacy\n") < readme.indexOf("\n## What was verified, and how\n"), "### Privacy sits under How it works");
  assert.ok(plugin.privacyPolicyUrl.endsWith("#privacy"));
});

test("the README names every command and every option the CLI has, the install lines, and the numbers of the pitch", () => {
  const readme = read("README.md");
  for (const cmd of ["check", "check --live", "fix", "undo", "explain"]) assert.ok(readme.includes(`### \`${cmd}\``), `a heading for ${cmd}`);
  for (const flag of ["--live", "--claude", "--project", "--json", "--markdown", "--git-bash", "--path", "--dry-run"]) assert.ok(readme.includes(`\`${flag}`), flag);
  for (const cmd of ["claude-windows-doctor check", "claude-windows-doctor fix --git-bash", "claude-windows-doctor undo", "claude-windows-doctor explain"]) assert.ok(readme.includes(cmd), cmd);
  assert.ok(readme.includes("npx -y github:nrzz/claude-windows-doctor check --project ."));
  assert.ok(readme.includes("git clone https://github.com/nrzz/claude-windows-doctor"));
  assert.ok(readme.includes("/plugin marketplace add nrzz/claude-code-toolkit"));
  assert.ok(readme.includes("/plugin install windows-doctor@claude-code-toolkit"));
  assert.ok(readme.includes("/windows-doctor:check"));
  for (const number of ["884 open issues", "476", "173", "#7490", "148 reactions"]) assert.ok(readme.includes(number), number);
  for (const x of ["Windows 10", "ARM64", "Microsoft Store", "Cygwin", "MSYS2", "desktop app's own shell choice", "VS Code extension"]) assert.ok(readme.includes(x), `Not verified names ${x}`);
  const notVerified = readme.slice(readme.indexOf("\n## Not verified\n"), readme.indexOf("\n## Files\n"));
  for (const x of ["Windows 10", "ARM64", "Microsoft Store", "Cygwin", "MSYS2", "desktop app", "VS Code"]) assert.ok(notVerified.includes(x), `the Not verified section names ${x}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(readme), "no emoji");
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing)\b/i.test(readme), "plain words");
});

test("the toolkit list: the fourteen lines, settings-doctor, automode-doctor, mcp-check, sandbox-doctor, the page line and the star line; this tool is not in its own list", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("\n## Part of the Claude Code toolkit\n"), readme.indexOf("\n## License\n"));
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(lines, TOOLKIT);
  assert.ok(!section.includes("claude-windows-doctor"), "not in its own list");
  assert.ok(section.includes("Small, dependency-free tools that make Claude Code cheaper, safer and easier to share, all in the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit):"));
  assert.ok(section.includes("Set up any of them, or all of them, from one page: `npx -y github:nrzz/claude-code-toolkit` opens it with the recommended tools switched on."));
  assert.ok(section.includes("If one of them saves you tokens, a star on its repository helps other people find it, and following [@nrzz](https://github.com/nrzz) on GitHub shows you new tools and releases."));
});

test("the links in the README that point into the repository go to files that are there", () => {
  const readme = read("README.md");
  for (const m of readme.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) assert.ok(exists(m[1].split("#")[0]), `${m[1]} is linked and exists`);
});

test("no test asks the machine for its home folder: every test builds its own world in a temporary folder", () => {
  for (const f of files("test", ".mjs")) {
    if (f.endsWith("repo.test.mjs") || f.endsWith("windows.test.mjs")) continue;
    assert.doesNotMatch(read(f), /os\.homedir\(\)/, `${f} reaches for the real home folder`);
  }
});

test("no test writes the registry, the Git configuration or the execution policy of the machine", () => {
  // reg add / reg delete, setx, Set-ExecutionPolicy, and git config with a scope flag that writes or with a key and a value
  const writesMachine = /reg(?:\.exe)?["'`]?\s*,\s*\[\s*["'`](add|delete)|\bsetx\b|Set-ExecutionPolicy|\[\s*["'`]config["'`]\s*,\s*["'`]--(?:global|system|local|unset|unset-all|add|replace-all|edit|rename-section|remove-section)|\[\s*["'`]config["'`]\s*,\s*["'`][a-z]+\.[a-z.]+["'`]\s*,\s*["'`]/;
  for (const f of files("test", ".mjs")) {
    if (f.endsWith("repo.test.mjs")) continue;
    const text = read(f);
    // pretend machines may record such command lines (test/winenv.test.mjs, test/fix.test.mjs); a real run may not make them
    if (/fakeMachine|winMachine|machine\.mjs|win-machine\.mjs/.test(text)) continue;
    assert.doesNotMatch(text, writesMachine, `${f} could write the real machine`);
  }
});

test("the process the tests run in has its home, config folder, managed folder and user environment pointed at a throwaway place", () => {
  assert.notEqual(process.env.CLAUDE_CONFIG_DIR, "");
  assert.ok(process.env.CLAUDE_CONFIG_DIR.startsWith(process.env.HOME), "the config folder is inside the throwaway home");
  assert.match(process.env.CLAUDE_WINDOWS_DOCTOR_MANAGED_DIR, /no-managed-settings$/);
  assert.match(process.env.CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE, /user-env\.json$/, "the user environment is a file: no test can write the registry");
  assert.equal(process.env.USERPROFILE, process.env.HOME);
  assert.equal(process.env.CLAUDE_CODE_GIT_BASH_PATH, undefined);
  assert.equal(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL, undefined);
});

test("the usage block of the README is the help text of the CLI, and nothing is left to fill in", async () => {
  const readme = read("README.md");
  const help = (await run(["--help"], { sys: winMachine() })).out;
  const usage = help.slice(help.indexOf("Usage: claude-windows-doctor")).trimEnd();
  assert.equal(help, HELP);
  assert.ok(readme.includes(usage), "the README's usage block is out of date: paste the output of claude-windows-doctor --help from its Usage line");
  assert.ok(!readme.includes("@@"), "a placeholder is still in the README");
});

test("the numbers the README quotes are the numbers of the code: the skill's instruction and description, the cap of the report", async () => {
  const readme = read("README.md");
  const skill = read("skills/check/SKILL.md");
  const body = skill.slice(/^---\n[\s\S]*?\n---\n/.exec(skill)[0].length);
  const instruction = body.split("\n").filter((l) => l && !l.startsWith("!`")).join("\n");
  assert.ok(readme.includes(`${instruction.length}-character instruction`), `the instruction is ${instruction.length} characters`);
  const desc = /^description: (.+)$/m.exec(skill)[1];
  assert.ok(readme.includes(`\`${desc}\`: ${desc.length} characters`), `the description is ${desc.length} characters`);
  assert.ok(readme.includes("at most 12 findings"));
  // the cap: 12 findings of a machine with many problems (16 variables of the user environment that this process does not have), and a line saying how many more
  const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`CLAUDE_X${i}_DIR`, ["REG_SZ", `D:\\data\\x${i}`]]));
  const capped = (await run(["check", "--markdown", "--project", "C:\\proj"], { sys: winMachine({ registry: { [REAL_KEY]: many } }) })).out;
  const lines = capped.trim().split("\n");
  assert.ok(lines.length <= 16, `${lines.length} lines: a header, the system, the shell, 12 findings and the line about the rest`);
  assert.equal(lines.filter((l) => l.startsWith("- WARNING")).length, 12);
  assert.match(lines.at(-1), /^- \.\.\. and 4 more \(run `claude-windows-doctor check`\)$/);
  for (const l of lines) assert.ok(l.length <= 500, `${l.length} characters in a line`);
});

test("the README lists every finding id that check can emit, in a table, and no other; explain has a page for each", () => {
  const readme = read("README.md");
  const start = readme.indexOf("\n| Id | Severity | What it says |");
  assert.ok(start > 0, "the table of findings is in the README");
  const table = readme.slice(start, readme.indexOf("\n\n", start + 5));
  const listed = [...table.matchAll(/^\| `([a-z0-9]+(?:-[a-z0-9]+)*)` \|/gm)].map((m) => m[1]).sort();
  const emitted = [...new Set([...read("src/findings.mjs").matchAll(/\bf\("([a-z0-9]+(?:-[a-z0-9]+)*)", "(?:error|warning|note)"/g)].map((m) => m[1]))].sort();
  assert.ok(emitted.length >= 25, `${emitted.length} ids in src/findings.mjs`);
  assert.deepEqual(listed, emitted, "the ids of the README and the ids of src/findings.mjs are the same");
  assert.equal(new Set(listed).size, listed.length, "no id twice");
  assert.deepEqual([...IDS].sort(), emitted, "and explain has a page for each");
});

test("the JSON shapes in the README: every field of a document and of the lists in it is named there, and every field named is in a document or marked optional", async () => {
  const readme = read("README.md");
  const start = readme.indexOf("\ncheck      { ok");
  assert.ok(start > 0, "the shapes are in the README");
  const block = readme.slice(start, readme.indexOf("\n```", start));
  // one entry per kind of document (a kind may have several shapes); a line that begins with a space belongs to the shape above it, and what follows // is a comment
  const entries = {};
  let current = null;
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\s\/\/.*$/, "");
    const m = /^([a-z]+)\s{2,}\{/.exec(line);
    if (m) { current = m[1]; entries[current] = entries[current] || ""; }
    if (current) entries[current] += `${line}\n`;
  }
  assert.deepEqual(Object.keys(entries), ["check", "fix", "undo", "explain", "error"]);
  const wsl = fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", cwd: "/home/me/code", files: ["/mnt/c/Users/me/.local/bin/claude"], texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" }, versions: { "/mnt/c/Users/me/.local/bin/claude": "2.1.299 (Claude Code)" } });
  const mac = fakeMachine({ platform: "darwin" });
  const win = winMachine({ noGit: true, files: ["C:\\Tools\\Git\\cmd\\git.exe", "C:\\Tools\\Git\\bin\\bash.exe", "C:\\Tools\\Git\\mingw64\\bin\\git.exe"], env: { Path: "C:\\Tools\\Git\\mingw64\\bin;C:\\Windows\\System32;C:\\Windows", CLAUDE_CODE_GIT_BASH_PATH: "C:\\nope\\bash.exe" }, registry: { [REAL_KEY]: { CLAUDE_CODE_TMPDIR: ["REG_SZ", "D:\\tmp"] } } });
  // a machine with a git.exe in the project folder (skipped), a Git Bash variable in the project settings (not used), a defaultShell, and a deny rule
  const busy = winMachine({
    noGit: true,
    dirs: ["C:\\proj"],
    files: ["C:\\proj\\git.exe", "C:\\Tools\\Git\\bin\\bash.exe"],
    env: { Path: "C:\\proj;C:\\Windows\\System32;C:\\Windows" },
    texts: {
      "C:\\Users\\me\\.claude\\settings.json": JSON.stringify({ defaultShell: "powershell", permissions: { deny: ["Bash"] } }),
      "C:\\proj\\.claude\\settings.json": JSON.stringify({ env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\Tools\\Git\\bin\\bash.exe" } }),
    },
  });
  const proved = async () => ({ ran: true, exitCode: 0, timedOut: false, requests: 1, tools: ["PowerShell"], shellTools: ["PowerShell"], edition: "Windows PowerShell 5.1 (powershell.exe)", using: null, warning: "CLAUDE_CODE_GIT_BASH_PATH \"C:/nope/bash.exe\" not found; falling back to auto-detection", notFound: true, stderr: "", cwd: "C:\\proj" });
  const json = async (args, o) => (await run([...args, "--json"], o)).json();
  const docs = {
    check: [
      await json(["check", "--project", "C:\\proj"], { sys: win }),
      await json(["check", "--project", "C:\\proj"], { sys: busy }),
      await json(["check", "--live", "--claude", "C:\\Users\\me\\.local\\bin\\claude.exe", "--project", "C:\\proj"], { sys: win, liveRunner: proved }),
      await json(["check", "--live", "--claude", "C:\\nope\\claude.exe", "--project", "C:\\proj"], { sys: win }),
      await json(["check"], { sys: wsl, tempDir: "/tmp/cwd-x" }),
      await json(["check"], { sys: mac }),
    ],
    fix: [
      await json(["fix", "--git-bash", "--dry-run", "--project", "C:\\proj"], { sys: winMachine({ noGit: true, files: ["C:\\Tools\\Git\\cmd\\git.exe", "C:\\Tools\\Git\\bin\\bash.exe", "C:\\Tools\\Git\\mingw64\\bin\\git.exe"], env: { Path: "C:\\Tools\\Git\\mingw64\\bin;C:\\Windows\\System32;C:\\Windows" }, registry: { [REAL_KEY]: { CLAUDE_CODE_GIT_BASH_PATH: ["REG_SZ", "C:\\old\\bash.exe"] } } }) }),
      await json(["fix", "--git-bash"], { sys: mac }),
    ],
    undo: [await json(["undo", "--dry-run"], { sys: win })],
    explain: [await json(["explain", "git-bash-not-found"], { sys: win }), await json(["explain", "--list"], { sys: win })],
    error: [await json(["explain"], { sys: win }), await json(["explain", "nosuch"], { sys: win })],
  };
  const everyKey = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach((x) => everyKey(x, out)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); everyKey(x, out); } return out; };
  // the tool names in shell.tools and shell.deny are keys that are data, not part of the shape
  const free = new Set(["Bash", "PowerShell"]);
  for (const [command, list] of Object.entries(docs)) {
    const words = [...entries[command].matchAll(/([A-Za-z][A-Za-z0-9]*)(\?)?/g)];
    const named = new Set(words.map((x) => x[1]));
    const anywhere = new Set(list.flatMap((d) => [...everyKey(d)]));
    for (const k of anywhere) if (!free.has(k)) assert.ok(named.has(k), `${command}: the field "${k}" is in a document and not in the README shape`);
    for (const [, name, optional] of words) {
      if (name === command || free.has(name)) continue;
      if (!optional) assert.ok(anywhere.has(name), `${command}: the README names the field "${name}", which no document has (mark it with ? if it is optional)`);
    }
  }
});

test("the Files table of the README names every source file, and every file it names is there", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("\n## Files\n"), readme.indexOf("\n## Contributing\n"));
  assert.ok(section.length > 100, "the section is there");
  for (const f of SOURCES) assert.ok(section.includes(`\`${posix(f)}\``), `${f} is in the Files table`);
  for (const dir of ["skills/check/", ".claude-plugin/", "test/"]) assert.ok(section.includes(`\`${dir}\``), `${dir} is in the Files table`);
  for (const m of section.matchAll(/`((?:src|bin|skills|\.claude-plugin|test)\/[^`\s]*)`/g)) assert.ok(exists(m[1].replace(/\/$/, "")), `${m[1]} is named in the Files table and exists`);
});
