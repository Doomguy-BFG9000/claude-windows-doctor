// The reports: text for a terminal, one JSON document for --json, and the short markdown that the skill hands to Claude.
// Nothing printed here may be a secret: an environment value is shown only for a path or a switch (src/userenv.mjs), and no settings file is
// shown whole.
import { VERSION } from "./version.mjs";
import { ORIGIN_TEXT } from "./binaries.mjs";
import { HOW, GIT_BASH_VAR } from "./shell.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const OS_NAME = { win32: "Windows", linux: "Linux", darwin: "macOS" };

export const NOTHING = (platform) => `Nothing to check on ${OS_NAME[platform] || platform}: claude-windows-doctor checks the setup of Claude Code on Windows, and from inside a WSL distribution the WSL side. Run it on Windows, or in WSL.`;

const header = (title) => `claude-windows-doctor ${VERSION}  ${title}`;

function bashLine(shell) {
  const g = shell.gitBash;
  if (g.path) return `yes: Git Bash at ${g.path} (${HOW[g.how]}${g.how === "variable" && g.variableSource.source ? `, ${g.variableSource.source}` : ""})`;
  return "no: Git Bash was not found";
}
function psLine(shell) {
  const p = shell.powershell;
  const edition = p.edition ? `, ${p.edition}` : "";
  if (shell.fatal) return "no: the tool is off, so Claude Code does not start";
  if (p.state === "yes") return `yes (${p.why})${edition}`;
  if (p.state === "no") return `no (${p.why})`;
  return `${p.why.replace(/^decided by your account/, "decided by your account")}${edition}`;
}

const stepText = (t) => {
  if (t.step === "variable") {
    if (t.state === "unset") return `${GIT_BASH_VAR}: not set`;
    const note = t.state === "valid" ? "used" : t.state === "not-found" ? "ignored: no such file" : "ignored: not named bash.exe, sh.exe, bash or sh";
    return `${GIT_BASH_VAR}: ${t.value} (${t.source}): ${note}`;
  }
  if (t.step === "program-files" || t.step === "program-files-x86") return `${t.path}: ${t.exists ? "found" : "not there"}`;
  if (t.step === "where-git") {
    if (t.lines === null) return "where git: where.exe could not run";
    if (!t.lines.length) return "where git: no git.exe on PATH";
    if (!t.chosen) return `where git: ${t.lines.length} line${t.lines.length === 1 ? "" : "s"}, none usable (${(t.skipped || []).map((s) => `${s.line}: ${s.reason}`).join("; ")})`;
    return `where git: ${t.chosen} is the first line${t.lines.length > 1 ? ` (of ${t.lines.length})` : ""}; two folders up, ${t.derived}: ${t.exists ? "found" : "not there"}`;
  }
  return t.step;
};

function windowsText(f) {
  const out = [];
  out.push(header("the Windows setup of Claude Code"));
  out.push(`project   ${f.project}`);
  out.push(`system    ${f.system.os} (${f.system.release}), ${f.system.arch}; Node ${f.node.node}${f.node.npm ? `, npm ${f.node.npm}` : ", no npm on PATH"}`);
  out.push("");
  out.push("The shell the model gets");
  out.push(`  Bash tool         ${bashLine(f.shell)}`);
  out.push(`  PowerShell tool   ${psLine(f.shell)}`);
  if (f.shell.deny.Bash.length) out.push(`  Bash tool         taken away by the deny rule "${f.shell.deny.Bash[0].rule}" (${f.shell.deny.Bash[0].display})`);
  if (f.shell.deny.PowerShell.length) out.push(`  PowerShell tool   taken away by the deny rule "${f.shell.deny.PowerShell[0].rule}" (${f.shell.deny.PowerShell[0].display})`);
  out.push("  how Claude Code looked for Git Bash, in its order:");
  let n = 0;
  for (const t of f.shell.gitBash.trail) {
    if (t.step === "program-files-x86") out.push(`       ${stepText(t)}`);
    else out.push(`    ${++n}  ${stepText(t)}`);
  }
  if (f.gitList.length) out.push(`  Git Bash files on this machine: ${f.gitList.map((g) => g.path).join(", ")}`);
  const ds = f.settingsFacts.defaultShell;
  out.push(`  defaultShell      ${ds.length ? ds.map((d) => `"${d.value}" (${d.display})`).join(", ") : "not set"}: the shell for the commands you type after !, not the model's tool`);
  if (f.bashStarts.checked) out.push(`  Git Bash starts   ${f.bashStarts.ok ? "yes" : `no: ${f.bashStarts.error}`}`);
  if (f.live) out.push(...liveText(f.live));
  out.push("");
  out.push("claude on this machine");
  if (!f.binaries.entries.length) out.push("  none found on PATH or in the places the installers use");
  f.binaries.entries.forEach((e, i) => {
    const v = e.version || (e.skipped ? "not run" : e.note ? "?" : "?");
    out.push(`  ${i + 1}  ${e.path}`);
    out.push(`      ${pad(v, 10)} ${ORIGIN_TEXT[e.origin]}${e.runsFirst ? "; runs first from a terminal" : e.onPath ? "; on PATH" : "; not on PATH"}${e.note ? `; ${e.note}` : ""}`);
  });
  if (f.binaries.entries.length && !f.binaries.first) out.push("  none of them is on PATH, so a terminal does not know the command claude");
  out.push("");
  out.push("The rest of the setup");
  out.push(`  long paths        Windows LongPathsEnabled ${f.longPaths.ok ? (f.longPaths.enabled ? "on" : "off") : "?"}; git core.longpaths ${f.git.ok ? (f.git.longpaths ? f.git.longpaths.value : "not set") : "?"}`);
  out.push(`  line endings      git core.autocrlf ${f.git.ok ? (f.git.autocrlf ? `${f.git.autocrlf.value} (${f.git.autocrlf.origin})` : "not set") : "?"}`);
  if (f.policy.ok) {
    const e = f.policy.effective;
    out.push(`  PowerShell policy ${f.policy.list.map((x) => `${x.scope} ${x.policy}`).join(", ")}; Claude Code's PowerShell gets ${e.bypassed ? "Process Bypass (it passes -ExecutionPolicy Bypass)" : `${e.policy} (${e.scope}${f.policy.respect ? "; CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY is on" : ""})`}`);
  } else out.push(`  PowerShell policy not read: ${f.policy.error}`);
  out.push(`  console           code page ${f.codePage.active || "?"}${f.codePage.oem ? `, system OEM ${f.codePage.oem}, ANSI ${f.codePage.ansi || "?"}` : ""}`);
  out.push(`  .git\\index.lock   ${f.indexLock.gitDir ? (f.indexLock.lock ? `${f.indexLock.lock.path}, ${f.indexLock.lock.gitRunning === false ? "no git is running" : f.indexLock.lock.gitRunning ? "a git process is running" : "could not tell whether git runs"}` : "none") : "no git repository here"}`);
  out.push("");
  out.push("User environment (HKCU\\Environment) against this process");
  if (!f.userEnv.ok) out.push(`  not read: ${f.userEnv.error}`);
  else if (!f.userEnv.entries.length) out.push(`  no CLAUDE_ or ANTHROPIC_ variable in either${f.userEnv.own ? ` (${f.userEnv.own} that Claude Code or this tool sets for its own programs are left out)` : ""}`);
  else {
    const shownValue = (s) => (s ? (s.value !== undefined ? s.value : "set") : "not set");
    const both = f.userEnv.entries.filter((e) => e.status !== "process-only");
    const only = f.userEnv.entries.filter((e) => e.status === "process-only");
    for (const e of both) out.push(`  ${pad(e.name, 34)} user: ${pad(shownValue(e.user), 8)}  this process: ${shownValue(e.process)}${e.status === "same" ? "" : `   (${e.status.replace("-", " ")})`}`);
    if (!both.length) out.push("  the user environment has no CLAUDE_ or ANTHROPIC_ variable");
    if (only.length) out.push(`  set in this process only: ${only.map((e) => (e.process && e.process.value !== undefined ? `${e.name} (${e.process.value})` : e.name)).join(", ")}`);
    if (f.userEnv.own) out.push(`  (${f.userEnv.own} that Claude Code or this tool sets for its own programs are left out)`);
  }
  out.push("");
  out.push("WSL");
  if (f.wsl.available) f.wsl.distros.forEach((d) => out.push(`  ${d.isDefault ? "*" : " "} ${pad(d.name, 18)} ${pad(d.state, 10)} WSL ${d.version}${d.internal ? "  (made by another tool, not one to work in)" : ""}`));
  else out.push(`  none installed${f.wsl.error ? ` (${f.wsl.error})` : ""}`);
  const mf = f.settings.files.filter((s) => s.exists);
  out.push("");
  out.push(`Settings files read: ${mf.length ? mf.map((s) => `${s.scope} ${s.display}${s.error ? " (ignored: not valid JSON)" : ""}`).join("; ") : "none exist"}`);
  out.push("");
  out.push(...findingsText(f));
  return `${out.join("\n")}\n`;
}

function liveText(live) {
  const out = [];
  if (!live.ok) return [`  live              not run: ${live.error}`];
  out.push(`  live              ${live.proved ? "proved" : "DID NOT MATCH"} with the real claude ${live.claude.version || ""} (${live.claude.path}), through a fake API on 127.0.0.1 (no token spent):`);
  out.push(`                    the first request listed ${live.actual.tools.length ? live.actual.tools.join(" and ") : "no shell tool"}${live.run.exitCode ? ` (it exited with code ${live.run.exitCode}${live.run.stderr ? `: ${live.run.stderr}` : ""})` : ""}${live.actual.bash ? `, and it took ${live.actual.bash}` : ""}${live.run.edition ? `; PowerShell edition: ${live.run.edition}` : ""}`);
  if (live.run.warning) out.push(`                    the binary says: ${live.run.warning}`);
  out.push(`                    the fake API has no account, so the account's default for the PowerShell tool is off there; predicted: ${live.predicted.tools.join(" and ") || "no shell tool"}`);
  for (const d of live.differences) out.push(`                    difference: ${d}`);
  return out;
}

function findingsText(f) {
  const out = [];
  if (!f.findings.length) { out.push("No findings."); return out; }
  out.push("Findings");
  for (const x of f.findings) {
    out.push(`  ${pad(x.severity, 7)} ${x.id}`);
    out.push(`      ${x.message}`);
    if (x.effect) out.push(`      what Claude Code does: ${x.effect}`);
    if (x.fix) out.push(`      fix: ${x.fix}`);
    out.push(`      more: claude-windows-doctor explain ${x.id}`);
  }
  out.push("");
  out.push(`${plural(f.counts.error, "error")}, ${plural(f.counts.warning, "warning")}, ${plural(f.counts.note, "note")}`);
  return out;
}

function wslText(f) {
  const out = [];
  out.push(header("the WSL side of Claude Code"));
  out.push(`project   ${f.project}`);
  out.push(`system    ${f.system.os}; WSL ${f.system.wsl}`);
  out.push("");
  out.push("claude on this distribution");
  if (!f.binaries.entries.length) out.push("  none found on PATH");
  f.binaries.entries.forEach((e, i) => out.push(`  ${i + 1}  ${e.path}   ${e.version || "?"}   ${ORIGIN_TEXT[e.origin]}${e.runsFirst ? "; runs first" : ""}`));
  out.push("");
  out.push(`config folder   ${f.locations.configDir} (${f.locations.configSource})${f.locations.configOnWindows ? ", on a Windows drive" : ""}`);
  out.push(`project         ${f.locations.project}${f.locations.projectOnWindows ? ", on a Windows drive" : ""}`);
  out.push("");
  out.push(...findingsText(f));
  return `${out.join("\n")}\n`;
}

export function checkText(f) {
  if (f.applicable === false) return `${header("nothing to check")}\n${NOTHING(f.platform)}\n`;
  return f.kind === "wsl" ? wslText(f) : windowsText(f);
}

export const MARKDOWN_LINE = 500;

/** cut() that ends at a space when there is one in the last 40 percent, so that a word or a path is not left in half. */
function cutWords(s, n) {
  if (s.length <= n) return s;
  const head = s.slice(0, n - 1);
  const at = head.lastIndexOf(" ");
  return `${(at > n * 0.6 ? head.slice(0, at) : head).trimEnd()}…`;
}

/**
 * One finding as a line of the markdown: the message and the fix always, what Claude Code does about it when there is room, and never more than
 * MARKDOWN_LINE characters. A message that is too long is cut so that the fix stays whole: the fix is what the model is asked to pass on.
 */
function markdownFinding(x) {
  const head = `- ${x.severity.toUpperCase()} \`${x.id}\`: `;
  const fix = x.fix ? ` Fix: ${x.fix}` : "";
  const effect = x.effect ? ` Effect: ${x.effect}` : "";
  for (const line of [`${head}${x.message}${effect}${fix}`, `${head}${x.message}${fix}`]) if (line.length <= MARKDOWN_LINE) return line;
  const room = MARKDOWN_LINE - head.length - fix.length;
  return room >= 80 ? `${head}${cutWords(x.message, room)}${fix}` : cut(`${head}${x.message}${fix}`, MARKDOWN_LINE);
}

/** The short report the skill hands to Claude: at most 12 findings, MARKDOWN_LINE characters a line. It is the same for every outcome (a skill whose command fails never reaches the model). */
export function checkMarkdown(f, { maxFindings = 12 } = {}) {
  if (f.applicable === false) return `## windows-doctor check\n${NOTHING(f.platform)}\n`;
  const out = [];
  if (f.kind === "wsl") {
    out.push(`## windows-doctor check (WSL): ${f.project}`);
    out.push(`${f.binaries.first ? `claude runs from ${f.binaries.first.path}${f.binaries.first.version ? ` (${f.binaries.first.version})` : ""}.` : "No claude on PATH."} ${plural(f.counts.error, "error")}, ${plural(f.counts.warning, "warning")}, ${plural(f.counts.note, "note")}.`);
  } else {
    out.push(`## windows-doctor check: ${f.project}`);
    const first = f.binaries.first;
    out.push(`${f.system.os}; ${first ? `claude ${first.version || "?"} runs first from ${first.path}` : "no claude on PATH"}.`);
    out.push(cut(`Shell: Bash tool ${f.shell.gitBash.path ? `yes, Git Bash at ${f.shell.gitBash.path} (${HOW[f.shell.gitBash.how]})` : "no, Git Bash not found"}; PowerShell tool ${f.shell.fatal ? "off, so Claude Code does not start" : f.shell.powershell.state === "yes" ? "yes" : f.shell.powershell.state === "no" ? "no" : "decided by the account"}. ${plural(f.counts.error, "error")}, ${plural(f.counts.warning, "warning")}, ${plural(f.counts.note, "note")}.`, 300));
  }
  const shown = f.findings.filter((x) => x.severity !== "note").slice(0, maxFindings);
  if (!f.findings.length) out.push("No findings.");
  for (const x of shown) out.push(markdownFinding(x));
  const more = f.findings.filter((x) => x.severity !== "note").length - shown.length;
  if (more > 0) out.push(`- ... and ${more} more (run \`claude-windows-doctor check\`)`);
  if (f.counts.note && !shown.length && !more) out.push(`- ${plural(f.counts.note, "note")} not shown (run \`claude-windows-doctor check\`)`);
  return `${out.join("\n")}\n`;
}

/** The JSON document of `check`. Paths are the paths of the system it ran on. */
export function checkJson(f) {
  if (f.applicable === false) return { ok: true, applicable: false, platform: f.platform, kind: f.kind, system: f.system, message: NOTHING(f.platform), findings: [], counts: f.counts };
  const base = { ok: f.counts.error + f.counts.warning === 0, applicable: true, platform: f.platform, kind: f.kind, project: f.project, system: f.system };
  if (f.kind === "wsl") {
    return { ...base, binaries: binariesJson(f.binaries), locations: f.locations, wslInherits: f.wslInherits, findings: f.findings.map(findingJson), counts: f.counts };
  }
  const s = f.shell;
  const variable = (v) => ({ value: v.value, source: v.source, ignored: (v.ignored || []).map((i) => ({ scope: i.scope, file: i.display, value: i.value })) });
  return {
    ...base,
    shell: {
      tools: s.tools,
      fatal: s.fatal,
      gitBash: { found: s.gitBash.path !== null, path: s.gitBash.path, how: s.gitBash.how, variable: variable(s.gitBash.variableSource), variableState: (s.gitBash.trail.find((t) => t.step === "variable") || {}).state, trail: s.gitBash.trail, starts: f.bashStarts, onMachine: f.gitList.map((g) => ({ path: g.path, via: g.via })) },
      powershell: { setting: s.powershell.setting, state: s.powershell.state, why: s.powershell.why, unread: s.powershell.unread, variable: variable(s.powershell.variable), edition: s.powershell.edition, path: s.powershell.path, how: s.powershell.how },
      deny: s.deny,
      defaultShell: f.settingsFacts.defaultShell,
      why: s.why,
    },
    binaries: binariesJson(f.binaries),
    settings: f.settings,
    machine: {
      node: f.node,
      longPaths: f.longPaths,
      git: f.git,
      executionPolicy: f.policy,
      codePage: f.codePage,
      indexLock: f.indexLock,
    },
    userEnv: f.userEnv,
    wsl: { available: f.wsl.available, distros: f.wsl.distros, defaultName: f.wsl.defaultName, workable: f.wsl.workable.map((d) => d.name), error: f.wsl.error },
    ...(f.live ? { live: liveJson(f.live) } : {}),
    findings: f.findings.map(findingJson),
    counts: f.counts,
  };
}

const findingJson = (x) => ({ id: x.id, severity: x.severity, message: x.message, effect: x.effect, fix: x.fix });
const binariesJson = (b) => ({ first: b.first ? b.first.path : null, entries: b.entries.map((e) => ({ path: e.path, origin: e.origin, onPath: e.onPath, runsFirst: Boolean(e.runsFirst), version: e.version, note: e.note, skipped: e.skipped })) });
const liveJson = (l) => (l.ok
  ? { ok: true, claude: l.claude, proved: l.proved, predicted: l.predicted, actual: l.actual, differences: l.differences, edition: l.run.edition, warning: l.run.warning, exitCode: l.run.exitCode, requests: l.run.requests }
  : { ok: false, error: l.error, claude: l.claude || null });

// ---- fix and undo
export function fixText(r, { what }) {
  const out = [];
  if (!r.ok) { out.push(`refused: ${r.refused}`); return `${out.join("\n")}\n`; }
  if (r.action === "nothing") { out.push(...r.notes); return `${out.join("\n")}\n`; }
  if (what === "fix") {
    out.push(`${r.dryRun ? "Would set" : "Set"} ${r.name}=${r.value} in the Windows user environment (${r.key}${r.layer === "file" ? ", a file standing in for the registry" : ""}). Found by: ${r.via}.`);
    if (!r.dryRun) out.push(`The record, for undo: ${r.record}`);
    for (const n of r.notes) out.push(n);
    if (!r.dryRun) out.push("Undo with: claude-windows-doctor undo");
  } else {
    for (const n of r.notes) out.push(n);
  }
  return `${out.join("\n")}\n`;
}

export function fixJson(r) {
  return { ok: r.ok, refused: r.ok ? null : r.refused, reason: r.reason, dryRun: r.dryRun, action: r.action, name: r.name, key: r.key, layer: r.layer, value: r.value, previous: r.previous, via: r.via, record: r.record, notes: r.notes };
}

// ---- explain
export function explainListText(pages) {
  const width = Math.max(...pages.map((p) => p.id.length));
  return `${pages.map((p) => `${p.id.padEnd(width)}   ${p.title}`).join("\n")}\n`;
}

export function explainListJson(pages) {
  return { ok: true, findings: pages };
}

export function explainText(p) {
  const out = [`${p.id}   ${p.title}`, "", p.means, "", "What Claude Code does"];
  for (const d of p.does) out.push(`  - ${d.source ? `(${d.source}) ` : ""}${d.text}`);
  out.push("", "The fix");
  for (const x of p.fix) out.push(`  - ${x}`);
  out.push("", p.issues.length ? "The issue threads" : "The issue threads: none found for this");
  for (const i of p.issues) out.push(`  #${i.number}  ${i.title}`, `        ${i.url}`);
  return `${out.join("\n")}\n`;
}

export function explainJson(p) {
  return { ok: true, id: p.id, title: p.title, means: p.means, does: p.does, fix: p.fix, issues: p.issues };
}

