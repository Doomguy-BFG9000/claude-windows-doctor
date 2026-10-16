// `check --live`: prove the shell choice with the real binary, at zero tokens. A fake Messages API listens on 127.0.0.1; the claude binary
// (the first on PATH, or --claude <path>) is started with `-p`, with ANTHROPIC_BASE_URL pointing at it, in a throwaway home, config folder
// and project folder, with every CLAUDE_*, ANTHROPIC_* and CLAUDECODE* variable of this machine taken out of its environment, and with
// updates and telemetry off. The tools of the first request are what the model would get; the debug log says which bash.exe was taken.
// No request leaves this machine and no token is spent.
//
// What the run copies from your setup: PATH and the rest of the environment, the two shell variables (CLAUDE_CODE_GIT_BASH_PATH and
// CLAUDE_CODE_USE_POWERSHELL_TOOL) as they are in this process, and from your settings files only the `env` entries of those two variables
// and the deny rules that take a whole shell tool away: no hook, no helper, no other setting is copied, so nothing of yours runs.
// This file and src/sys.mjs are the only code that starts a program, and this file the only one that opens a connection (a server on
// 127.0.0.1, for the fake API).
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { GIT_BASH_VAR, PS_VAR, VAR_SCOPES, expectedTools, predictShell } from "./shell.mjs";
import { makeLiveWorld, readDebugLog } from "./write.mjs";
import { wholeToolDeny } from "./settings.mjs";

const USAGE = { input_tokens: 1, output_tokens: 1 };
const TIMEOUT_MS = 120000;

function reply(id, model, text) {
  return [
    ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: model || "x", content: [], stop_reason: null, usage: USAGE } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

/** The fake Messages API: every request is recorded, every answer is the text PROBE-DONE. */
export function startFakeApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (!req.url.includes("/v1/messages")) { res.writeHead(404); res.end("{}"); return; }
      let j = {};
      try { j = JSON.parse(body); } catch { /* empty */ }
      requests.push(j);
      const n = requests.length;
      if (j.stream === false) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: j.model || "x", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: USAGE }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [ev, data] of reply(`msg_${n}`, j.model, "PROBE-DONE")) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve({ port: server.address().port, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
    });
  });
}

/** The settings that a live run gets: the `env` of the two shell variables and the whole-tool deny rules, by scope. Managed settings are put in the user file. */
export function liveSettings(facts) {
  const out = { user: { env: {}, permissions: { deny: [] } }, project: { env: {}, permissions: { deny: [] } }, local: { env: {}, permissions: { deny: [] } } };
  for (const scope of ["user", "project", "local", "managed"]) {
    const target = out[scope === "managed" ? "user" : scope];
    for (const name of [GIT_BASH_VAR, PS_VAR]) {
      if (!VAR_SCOPES[name].includes(scope)) continue;
      const block = facts.env[scope] || {};
      if (Object.prototype.hasOwnProperty.call(block, name)) target.env[name] = block[name];
    }
  }
  for (const d of facts.deny) if (wholeToolDeny(d.rule)) out[d.scope === "managed" ? "user" : d.scope].permissions.deny.push(d.rule);
  const clean = {};
  for (const [scope, s] of Object.entries(out)) {
    const o = {};
    if (Object.keys(s.env).length) o.env = s.env;
    if (s.permissions.deny.length) o.permissions = { deny: s.permissions.deny };
    if (Object.keys(o).length) clean[scope] = o;
  }
  return clean;
}

/** The environment of the live run: this machine's, without CLAUDE_*, ANTHROPIC_*, CLAUDECODE*, AI_AGENT, MCP_* and ENABLE_TOOL_SEARCH, plus the two shell variables as this process has them. */
export function liveEnv(sys, world, port) {
  const env = {};
  for (const [k, v] of Object.entries(sys.env)) if (!/^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH)/i.test(k)) env[k] = v;
  const set = (name, value) => {
    const lower = name.toLowerCase();
    for (const k of Object.keys(env)) if (k.toLowerCase() === lower) delete env[k];
    if (value !== undefined) env[name] = value;
  };
  for (const name of [GIT_BASH_VAR, PS_VAR]) set(name, sys.getEnv(name));
  set("DISABLE_AUTOUPDATER", "1");
  set("DISABLE_TELEMETRY", "1");
  set("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
  set("NO_COLOR", "1");
  set("HOME", world.home);
  set("USERPROFILE", world.home);
  set("CLAUDE_CONFIG_DIR", world.cfg);
  set("ANTHROPIC_API_KEY", "sk-ant-probe");
  set("ANTHROPIC_BASE_URL", `http://127.0.0.1:${port}`);
  return env;
}

function killTree(child) {
  try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

const userText = (j) => (j.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""))).join("\n");

/**
 * Runs the binary and reads the tools of its first request.
 *   claudePath  the claude to run (a .exe, or an npm .cmd shim)
 *   base        a throwaway folder (the caller makes and removes it)
 * Returns { ran, exitCode, timedOut, tools, shellTools, edition, using, warning, notFound, stderr, requests } or { ran: false, error }.
 */
export async function runBinary(sys, { claudePath, base, facts }) {
  const world = makeLiveWorld(base, { settings: liveSettings(facts) });
  const api = await startFakeApi();
  try {
    const env = liveEnv(sys, world, api.port);
    const args = ["-p", "PROBE-MAIN hello", "--output-format", "json", "--debug-file", world.debugFile];
    const shim = /\.(cmd|bat)$/i.test(claudePath);
    const child = shim
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${claudePath}" ${args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ")}"`], { cwd: world.work, env, windowsHide: true, windowsVerbatimArguments: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(claudePath, args, { cwd: world.work, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let spawnError = null;
    child.on("error", (e) => { spawnError = e; });
    child.stdout.on("data", () => { /* the answer of the fake API; not needed */ });
    child.stderr.on("data", (d) => { stderr += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    const exitCode = await new Promise((resolve) => child.on("close", (code) => { clearTimeout(timer); resolve(code); }));
    if (spawnError) return { ran: false, error: `${claudePath} could not be started (${spawnError.code || spawnError.message})` };
    const main = api.requests.find((r) => userText(r).includes("PROBE-MAIN")) || api.requests[0];
    const tools = main && main.tools ? main.tools.map((t) => t.name) : [];
    const ps = main && main.tools ? main.tools.find((t) => t.name === "PowerShell") : null;
    const log = readDebugLog(world.debugFile);
    return {
      ran: true,
      exitCode,
      timedOut,
      requests: api.requests.length,
      tools,
      shellTools: tools.filter((n) => n === "Bash" || n === "PowerShell"),
      edition: ps ? (/PowerShell edition: ([^\n]*)/.exec(ps.description) || [])[1] || null : null,
      using: (/Using bash path: "([^"]*)"/.exec(log) || [])[1] || null,
      warning: (/CLAUDE_CODE_GIT_BASH_PATH "[^\n]*falling back to auto-detection/.exec(log) || [])[0] || null,
      notFound: /Git Bash not found; BashTool will be unavailable/.test(log),
      stderr: stderr.trim().split(/\r?\n/)[0] || "",
      cwd: world.work,
    };
  } finally {
    await api.close();
  }
}

/**
 * `check --live`: runs the binary and compares what it listed with the prediction for the same run.
 * Returns { ok, claude, result, predicted, proved, differences } where ok is false only when the binary could not be run.
 */
export async function proveShell(sys, { claudePath, base, facts, version = null, runner = runBinary }) {
  const run = await runner(sys, { claudePath, base, facts });
  if (!run.ran) return { ok: false, claude: { path: claudePath, version }, error: run.error };
  // the prediction for the run as it was: the same environment, and the working folder of the run
  const prediction = predictShell(sys, { cwd: run.cwd, facts });
  const predicted = { tools: expectedTools(prediction), exit: prediction.fatal ? 1 : 0, bash: prediction.gitBash.path, how: prediction.gitBash.how };
  const actual = { tools: run.shellTools, exit: run.exitCode === 0 ? 0 : 1, bash: run.using };
  const differences = [];
  if (JSON.stringify(predicted.tools) !== JSON.stringify(actual.tools)) differences.push(`the binary listed ${actual.tools.join(" and ") || "no shell tool"}; the prediction was ${predicted.tools.join(" and ") || "no shell tool"}`);
  if (predicted.exit !== actual.exit) differences.push(`the binary exited with code ${run.exitCode}; the prediction was ${predicted.exit}`);
  if (actual.exit === 0 && predicted.bash && actual.bash && path.win32.normalize(predicted.bash).toLowerCase() !== path.win32.normalize(actual.bash).toLowerCase()) differences.push(`the binary took ${actual.bash}; the prediction was ${predicted.bash}`);
  if (actual.exit === 0 && !predicted.bash && actual.bash) differences.push(`the binary took ${actual.bash}; the prediction found no Git Bash`);
  return { ok: true, claude: { path: claudePath, version }, run, predicted, actual, proved: differences.length === 0, differences };
}
