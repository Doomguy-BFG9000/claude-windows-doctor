// Running the real claude binary at zero cost, for the checks that need it (test/e2e-*.test.mjs).
//
// A check runs only when E2E_CLAUDE names a Claude Code binary ("claude" on a CI machine after
// `npm install -g @anthropic-ai/claude-code`, or the full path to claude.exe). Otherwise it is skipped, and `npm test` needs nothing
// but Node. The binary runs in a throwaway folder with its own config folder and home, with an environment scrubbed of every
// CLAUDE_* and ANTHROPIC_* variable of the machine, and with ANTHROPIC_BASE_URL pointing at a tiny server on 127.0.0.1 that answers
// from a script. No request leaves the machine, no token is spent, no login is needed. The binary is started with spawn
// (asynchronous) and with stdin ignored: a spawnSync would block the event loop that the fake server lives in, and `-p` waits for
// input on an open stdin. DISABLE_TELEMETRY and CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC are always set.
//
// Unlike the sandboxes of the other tools, this one does not put Git Bash in the environment: which shell tools the binary lists is
// what is under test, so PATH and the two shell variables are each run's own.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpDir } from "./helpers.mjs";

export const IS_WIN = process.platform === "win32";
const USAGE = { input_tokens: 1, output_tokens: 1 };

/** The binary the checks run: E2E_CLAUDE as it is when it is a path, else the first `claude` that where.exe or the PATH finds, as a full path (a name would be looked up in each run's own PATH). */
export function resolveClaude(name = process.env.E2E_CLAUDE || "") {
  if (!name) return "";
  if (/[\\/]/.test(name)) return name;
  const found = IS_WIN
    ? spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/).filter(Boolean)
    : spawnSync("which", [name], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
  if (!found.length) return name;
  // an npm install puts claude.cmd next to a node_modules folder that holds the native binary; start that one, not the shim
  for (const f of found) {
    const native = path.join(path.dirname(f), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (IS_WIN && /\.cmd$/i.test(f) && fs.existsSync(native)) return native;
  }
  return found.find((f) => !/\.ps1$/i.test(f)) || found[0];
}
export const CLAUDE = resolveClaude();
const viaShell = () => IS_WIN && !/\.exe$/i.test(CLAUDE);

/** A scrubbed environment: none of the machine's CLAUDE_* and ANTHROPIC_* variables, no updates, no telemetry. `extra` entries win; an undefined value removes the variable (in any case). */
export function baseEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH)/i.test(k)) env[k] = v;
  Object.assign(env, { DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", NO_COLOR: "1" });
  for (const [k, v] of Object.entries(extra)) setVar(env, k, v);
  return env;
}

/** Sets a variable whatever the case of an existing spelling (Windows keeps `Path`); an undefined value removes it. */
export function setVar(env, name, value) {
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(env)) if (k.toLowerCase() === lower) delete env[k];
  if (value !== undefined && value !== null) env[name] = value;
  return env;
}

let info;
/** { ok, version, number, reason }: whether E2E_CLAUDE names a binary that runs, and the version it prints. */
export function claudeInfo() {
  if (info) return info;
  if (!CLAUDE) return (info = { ok: false, version: "", number: "", reason: "E2E_CLAUDE is not set (point it at a claude binary to run the checks against the real thing)" });
  const home = tmpDir("cwd-e2e-probe-");
  const r = spawnSync(CLAUDE, ["--version"], { encoding: "utf8", timeout: 60000, windowsHide: true, shell: viaShell(), input: "", env: baseEnv({ CLAUDE_CONFIG_DIR: path.join(home, ".claude"), HOME: home, USERPROFILE: home }) });
  const version = (r.stdout || "").trim();
  info = r.status === 0 && version ? { ok: true, version, number: (/\d+\.\d+\.\d+/.exec(version) || [""])[0], reason: "" } : { ok: false, version: "", number: "", reason: `E2E_CLAUDE (${CLAUDE}) did not run: ${(r.error && r.error.message) || (r.stderr || "").trim().slice(0, 120)}` };
  return info;
}
/** The value for node:test's `skip` option: false when the binary is there, else the reason. */
export const skip = () => (claudeInfo().ok ? false : claudeInfo().reason);
/** The same for the checks that need Windows. */
export const skipUnlessWindows = () => skip() || (!IS_WIN && "this check is about Windows");

/**
 * A throwaway world for the binary: home, a config folder and a project folder that Claude Code already trusts.
 *   cfg/settings.json                 the user's settings
 *   work/.claude/settings.json        the project's settings
 *   work/.claude/settings.local.json  the local settings
 */
export function sandbox(label) {
  const root = tmpDir(`cwd-e2e-${label}-`);
  const home = path.join(root, "home");
  const cfg = path.join(root, "cfg");
  const work = path.join(root, "work");
  for (const d of [home, cfg, work]) fs.mkdirSync(d, { recursive: true });
  const trust = { hasTrustDialogAccepted: true, allowedTools: [] };
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, projects: { [work]: trust, [work.replace(/\\/g, "/")]: trust } }));
  return {
    root, home, cfg, work,
    debug: path.join(root, "debug.log"),
    user: path.join(cfg, "settings.json"),
    project: path.join(work, ".claude", "settings.json"),
    local: path.join(work, ".claude", "settings.local.json"),
    managed: path.join(root, "managed"),
  };
}

/** Write a file: an object as JSON, a string as it is. */
export function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

// ---- the fake Messages API ---------------------------------------------------------------------------------------------

const msgStart = (id, model) => ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: model || "x", content: [], stop_reason: null, usage: USAGE } }];

/** SSE events for an assistant message with the given blocks: { text } or { tool, input, id }. */
export function message(id, model, blocks) {
  const ev = [msgStart(id, model)];
  blocks.forEach((b, i) => {
    if (b.text !== undefined) {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }]);
    } else {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id || `toolu_${id}_${i}`, name: b.tool, input: {} } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    ev.push(["content_block_stop", { type: "content_block_stop", index: i }]);
  });
  ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: blocks.some((b) => b.tool) ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }]);
  ev.push(["message_stop", { type: "message_stop" }]);
  return ev;
}

/** All the text the user side of a request holds (the prompt, expanded skills, tool results). */
export const userText = (j) => (j.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""))).join("\n");
/** Every text block of a request's messages. */
export const textBlocks = (request) => (request.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content])).map((b) => (typeof b === "string" ? b : (b && b.text) || ""));

/**
 * The fake Messages API. Every request is recorded in `requests`, whole. The conversation is answered with the tool calls the script
 * names, one per turn ({ tool, input }), then "PROBE-DONE". Returns { port, requests, close() }.
 */
export function fakeApi(calls = []) {
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
      const turn = (j.messages || []).filter((m) => m.role === "assistant").length;
      const step = calls[turn];
      const events = step && step.tool ? message(`msg_${n}`, j.model, [{ tool: step.tool, id: `toolu_${turn}`, input: step.input }]) : message(`msg_${n}`, j.model, [{ text: (step && step.text) || "PROBE-DONE" }]);
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [ev, data] of events) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve({ port: server.address().port, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

// ---- running the binary ------------------------------------------------------------------------------------------------

function killTree(child) {
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/**
 * Run claude in the sandbox's project folder. Resolves { code, out, err, result, ms } (result: the --output-format json document).
 * `api` is the fake API the binary talks to; null for a command that needs none (claude doctor, claude plugin validate).
 * `env` entries replace the variables of the scrubbed environment (an undefined value removes one).
 */
export function runClaude(sb, api, args, { timeout = 120000, env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const childEnv = baseEnv({ CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home, ...(api ? { ANTHROPIC_API_KEY: "sk-ant-probe", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` } : {}), ...env });
    const quoted = [CLAUDE, ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    const where = cwd || sb.work;
    const started = Date.now();
    const child = viaShell() ? spawn(quoted, [], { cwd: where, env: childEnv, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }) : spawn(CLAUDE, args, { cwd: where, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN });
    let out = "";
    let err = "";
    child.on("error", (e) => { err += String(e); });
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => killTree(child), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      let result = null;
      try { result = JSON.parse(out); } catch { /* not json */ }
      resolve({ code, out, err, result, ms: Date.now() - started, env: childEnv });
    });
  });
}

/** The main request of a run (the one with PROBE-MAIN in its prompt), the names of its tools, and the shell tools among them. */
export const mainRequest = (api) => api.requests.find((r) => userText(r).includes("PROBE-MAIN")) || api.requests[0];
export const toolNames = (req) => (req && req.tools ? req.tools.map((t) => t.name) : []);
export const shellTools = (req) => toolNames(req).filter((n) => n === "Bash" || n === "PowerShell");
/** The edition line of the PowerShell tool's description, or null. */
export const editionOf = (req) => {
  const t = ((req && req.tools) || []).find((x) => x.name === "PowerShell");
  return t ? (/PowerShell edition: ([^\n]*)/.exec(t.description) || [])[1] || null : null;
};

/** What the debug log says about Git Bash: { using, warning, notFound }. */
export function debugInfo(file) {
  const log = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return {
    using: (/Using bash path: "([^"]*)"/.exec(log) || [])[1] || null,
    warning: (/CLAUDE_CODE_GIT_BASH_PATH "[^\n]*falling back to auto-detection/.exec(log) || [])[0] || null,
    notFound: /Git Bash not found; BashTool will be unavailable/.test(log),
  };
}

/** One `claude -p` run with the fake API: { api, r, request, tools, debug }. The api is closed. */
export async function probeRun(sb, { env = {}, prompt = "PROBE-MAIN hello", args = [], calls = [], timeout } = {}) {
  const api = await fakeApi(calls);
  try {
    const r = await runClaude(sb, api, ["-p", prompt, "--output-format", "json", "--debug-file", sb.debug, ...args], { env, timeout });
    const request = mainRequest(api);
    return { api, r, request, tools: shellTools(request), debug: debugInfo(sb.debug) };
  } finally { await api.close(); }
}
