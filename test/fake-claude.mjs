// A stand-in for the claude binary, for the tests of src/live.mjs: it does what the real one does that the live check reads, and no more. It
// sends one request to the Messages API at ANTHROPIC_BASE_URL with the tools that FAKE_CLAUDE_TOOLS names (the prompt after -p in a user
// message), writes the lines of FAKE_CLAUDE_DEBUG to the file after --debug-file, exits with FAKE_CLAUDE_EXIT (and says so on stderr when that is
// not 0, without sending anything), and writes the names of its environment variables, and a few values, to the file FAKE_CLAUDE_DUMP.
import fs from "node:fs";
import http from "node:http";

const args = process.argv.slice(2);
// the runner of `node --test` also starts every file of test/ on its own, with no arguments: then this is a helper, not a test, and it sends nothing
if (!args.includes("-p")) process.exit(0);
const after = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const env = process.env;
if (env.FAKE_CLAUDE_DUMP) {
  const keep = ["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "DISABLE_TELEMETRY", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_USE_POWERSHELL_TOOL", "NO_COLOR"];
  const settingsOf = (dir) => { try { return JSON.parse(fs.readFileSync(`${dir}/settings.json`, "utf8")); } catch { return null; } };
  const projectSettings = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  fs.writeFileSync(env.FAKE_CLAUDE_DUMP, JSON.stringify({
    names: Object.keys(env).sort(),
    values: Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]])),
    args,
    cwd: process.cwd(),
    userSettings: settingsOf(env.CLAUDE_CONFIG_DIR),
    projectSettings: projectSettings(`${process.cwd()}/.claude/settings.json`),
    localSettings: projectSettings(`${process.cwd()}/.claude/settings.local.json`),
    claudeJson: projectSettings(`${env.CLAUDE_CONFIG_DIR}/.claude.json`),
  }));
}
const debug = after("--debug-file");
if (debug && env.FAKE_CLAUDE_DEBUG) fs.writeFileSync(debug, `${env.FAKE_CLAUDE_DEBUG.split("|").join("\n")}\n`);
const code = Number(env.FAKE_CLAUDE_EXIT || 0);
if (code) { process.stderr.write("Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled (CLAUDE_CODE_USE_POWERSHELL_TOOL=0).\nsecond line\n"); process.exit(code); }
const names = (env.FAKE_CLAUDE_TOOLS || "").split(",").filter(Boolean);
const tools = [...names.map((name) => ({ name, description: name === "PowerShell" ? "Executes PowerShell.\n\nPowerShell edition: PowerShell 7+ (pwsh)\n - x" : `the ${name} tool`, input_schema: { type: "object" } })), { name: "Read", description: "Reads", input_schema: { type: "object" } }];
const body = JSON.stringify({ model: "x", max_tokens: 1, stream: true, messages: [{ role: "user", content: [{ type: "text", text: after("-p") || "" }] }], tools });
const u = new URL(`${env.ANTHROPIC_BASE_URL}/v1/messages`);
const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => { res.resume(); res.on("end", () => process.exit(0)); });
req.on("error", () => process.exit(3));
req.end(body);
