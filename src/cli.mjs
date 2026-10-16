// The command line: the options, the help, the exit codes. 0 ok, 1 findings or a refusal, 2 a usage error.
import path from "node:path";
import { VERSION } from "./version.mjs";
import { makeSys } from "./sys.mjs";
import { regUserEnv } from "./winenv.mjs";
import { fileUserEnv, makeTempDir, removeTempDir } from "./write.mjs";
import { collectWindows, collectWsl, kindOf, notApplicable } from "./check.mjs";
import { versionOf } from "./binaries.mjs";
import { proveShell } from "./live.mjs";
import { runFix, runUndo } from "./fix.mjs";
import { IDS, nearIds, pageFor } from "./explain.mjs";
import { checkJson, checkMarkdown, checkText, explainJson, explainText, fixJson, fixText } from "./report.mjs";

export const HELP = `Usage: claude-windows-doctor <command> [options]

Read (they change nothing):
  check    [--live] [--claude <path>] [--project <dir>] [--markdown]
           on Windows: the shell tools Claude Code gives the model (the Bash tool when it finds Git
           Bash, the PowerShell tool) and why, in the order Claude Code looks; every claude on PATH
           and in the places the installers use, with its version and which one runs first; Node and
           npm; long paths; git core.autocrlf; the PowerShell execution policy; the console code
           page; a stale .git\\index.lock; the CLAUDE_* and ANTHROPIC_* variables of the user
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
           the Windows user environment (HKCU\\Environment), and record what was there before in
           <config folder>\\windows-doctor\\record.json. Without --path the Git Bash found on this
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
managed-settings.json from, instead of C:\\Program Files\\ClaudeCode; the tests use it) and
CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE (a JSON file that stands in for HKCU\\Environment; the tests use it).
It reads files, the registry and the output of a few Windows programs, and starts claude --version and
(with --live) claude -p in throwaway folders. It writes only with fix and undo, and it sends nothing to
Anthropic or anyone else.
`;

const COMMANDS = {
  check: { options: ["project", "json", "markdown", "live", "claude"], positional: 0 },
  explain: { options: ["json"], positional: 1, required: true },
  fix: { options: ["project", "json", "dryRun", "gitBash", "path"], positional: 0 },
  undo: { options: ["project", "json", "dryRun"], positional: 0 },
};

const FLAGS = { "--json": "json", "--markdown": "markdown", "--live": "live", "--dry-run": "dryRun", "--git-bash": "gitBash", "-h": "help", "--help": "help", "-v": "version", "--version": "version" };
const VALUES = { "--project": "project", "--claude": "claude", "--path": "path" };

class UsageError extends Error {}

/** Reads the argument list. Returns { command, id, project, claude, path, json, markdown, live, dryRun, gitBash, help, version, given } or throws a UsageError. */
export function parseArgs(argv) {
  const o = { command: null, id: null, project: undefined, claude: undefined, path: undefined, json: false, markdown: false, live: false, dryRun: false, gitBash: false, help: false, version: false, given: new Set() };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z-]+)=(.*)$/s.exec(a);
    const flag = eq ? eq[1] : a;
    if (Object.prototype.hasOwnProperty.call(VALUES, flag)) {
      const key = VALUES[flag];
      const value = eq ? eq[2] : argv[++i];
      if (value === undefined || (!eq && /^--?[A-Za-z]/.test(value) && key !== "project")) throw new UsageError(`${flag} needs a value`);
      o.given.add(key);
      o[key] = value;
    } else if (Object.prototype.hasOwnProperty.call(FLAGS, flag) && !eq) {
      o[FLAGS[flag]] = true;
      o.given.add(FLAGS[flag]);
    } else if (a.startsWith("-") && a !== "-") {
      throw new UsageError(`unknown option ${a}`);
    } else positional.push(a);
  }
  if (o.help || o.version) return o;
  if (!positional.length) throw new UsageError("no command given");
  o.command = positional[0];
  const spec = COMMANDS[o.command];
  if (!spec) throw new UsageError(`unknown command "${o.command}"`);
  for (const key of o.given) if (key !== "help" && key !== "version" && !spec.options.includes(key)) throw new UsageError(`${o.command} does not take --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  const rest = positional.slice(1);
  if (rest.length > spec.positional) throw new UsageError(`${o.command} takes ${spec.positional === 0 ? "no name" : "one finding id"}, not "${rest.join(" ")}"`);
  if (spec.required && rest.length === 0) throw new UsageError(`${o.command} needs a finding id (${IDS.join(", ")})`);
  o.id = rest[0] || null;
  if (o.command === "check" && o.claude !== undefined && !o.live) throw new UsageError("--claude is for --live: it names the claude to run");
  if (o.command === "fix" && !o.gitBash) throw new UsageError("fix needs what to fix: --git-bash");
  if (o.command === "fix" && o.path !== undefined && !o.gitBash) throw new UsageError("--path goes with --git-bash");
  if (o.command === "check" && o.markdown && o.live) throw new UsageError("--markdown is the short report of the skill and does not run --live");
  return o;
}

const errorDoc = (message) => ({ ok: false, error: message });

function pickUserEnv(io, sys) {
  if (io.userEnv) return io.userEnv;
  const file = sys.getEnv("CLAUDE_WINDOWS_DOCTOR_USER_ENV_FILE");
  if (file) return fileUserEnv(file);
  return regUserEnv(sys);
}

/**
 * Runs the command line. `io` replaces the real machine for the tests:
 *   { sys, userEnv, store, env, now, stdout: { write }, stderr: { write }, tempDir, liveRunner }
 * Returns the exit code.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (argv.includes("--json")) stdout.write(`${JSON.stringify(errorDoc(e.message))}\n`);
    else stderr.write(`claude-windows-doctor: ${e.message}\nRun claude-windows-doctor --help for the commands.\n`);
    return 2;
  }
  if (o.help) { stdout.write(HELP); return 0; }
  if (o.version) { stdout.write(`claude-windows-doctor ${VERSION}\n`); return 0; }
  const emit = (doc, text) => stdout.write(o.json ? `${JSON.stringify(doc, null, 2)}\n` : text);
  let tempDir = null;
  let ownTemp = false;
  try {
    const sys = io.sys || makeSys(io.env ? { env: io.env } : {});
    const project = o.project === undefined ? undefined : (path[sys.platform === "win32" ? "win32" : "posix"].isAbsolute(o.project) ? o.project : path[sys.platform === "win32" ? "win32" : "posix"].join(sys.cwd, o.project));

    if (o.command === "explain") {
      const page = pageFor(o.id);
      if (!page) {
        const near = nearIds(o.id);
        if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: `no finding called "${o.id}"`, ids: IDS, near }, null, 2)}\n`);
        else stderr.write(`claude-windows-doctor: no finding called "${o.id}".${near.length ? ` Did you mean ${near.join(", ")}?` : ""}\nThe ids: ${IDS.join(", ")}\n`);
        return 1;
      }
      emit(explainJson(page), explainText(page));
      return 0;
    }

    if (o.command === "fix" || o.command === "undo") {
      const userEnv = pickUserEnv(io, sys);
      const store = io.store || undefined;
      const result = o.command === "fix" ? runFix(sys, { userEnv, project, bashPath: o.path, dryRun: o.dryRun, now: io.now, store }) : runUndo(sys, { userEnv, dryRun: o.dryRun, store });
      emit(fixJson(result), fixText(result, { what: o.command }));
      return result.ok ? 0 : 1;
    }

    // check
    const kind = kindOf(sys);
    if (kind === "other") {
      const f = notApplicable(sys);
      if (o.live) {
        const msg = "check --live proves the shell choice of Claude Code on Windows: there is nothing to prove here";
        if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: msg, applicable: false, platform: sys.platform }, null, 2)}\n`); else stderr.write(`${msg}\n`);
        return 1;
      }
      if (o.markdown) stdout.write(checkMarkdown(f)); else emit(checkJson(f), checkText(f));
      return 0;
    }
    if (o.live && kind !== "windows") {
      const msg = "check --live proves the shell choice of Claude Code on Windows, and works on Windows only";
      if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: msg, platform: sys.platform }, null, 2)}\n`); else stderr.write(`${msg}\n`);
      return 1;
    }
    if (io.tempDir) tempDir = io.tempDir;
    else { tempDir = makeTempDir(sys.tmpdir); ownTemp = true; }
    const facts = kind === "windows" ? collectWindows(sys, { project, userEnv: pickUserEnv(io, sys), dir: tempDir }) : collectWsl(sys, { project, dir: tempDir });
    let liveFailed = false;
    if (o.live) {
      const target = o.claude ? { path: o.claude } : facts.binaries.first && !facts.binaries.first.skipped ? { path: facts.binaries.first.path } : null;
      if (!target) {
        facts.live = { ok: false, error: `no claude on PATH to run (pass --claude <path>${facts.binaries.entries.filter((e) => !e.skipped).length ? `; found: ${facts.binaries.entries.filter((e) => !e.skipped).map((e) => e.path).join(", ")}` : ""})` };
        liveFailed = true;
      } else if (!sys.isFile(target.path)) {
        facts.live = { ok: false, error: `${target.path} is not a file`, claude: { path: target.path } };
        liveFailed = true;
      } else {
        const entry = facts.binaries.entries.find((e) => e.path.toLowerCase() === target.path.toLowerCase());
        const version = entry && entry.version ? entry.version : versionOf(sys, target.path, tempDir);
        const base = io.tempDir ? io.tempDir : makeTempDir(sys.tmpdir, "cwd-live-");
        try { facts.live = await proveShell(sys, { claudePath: target.path, base, facts: facts.settingsFacts, version, ...(io.liveRunner ? { runner: io.liveRunner } : {}) }); } finally { if (!io.tempDir) removeTempDir(base); }
        liveFailed = !facts.live.ok || !facts.live.proved;
      }
    }
    if (o.markdown) { stdout.write(checkMarkdown(facts)); return 0; }
    emit(checkJson(facts), checkText(facts));
    return facts.counts.error + facts.counts.warning > 0 || liveFailed ? 1 : 0;
  } catch (e) {
    if (o.json) stdout.write(`${JSON.stringify(errorDoc(String(e && e.message ? e.message : e)))}\n`);
    else stderr.write(`claude-windows-doctor: ${e && e.message ? e.message : e}\n`);
    return 2;
  } finally {
    if (ownTemp && tempDir) removeTempDir(tempDir);
  }
}
