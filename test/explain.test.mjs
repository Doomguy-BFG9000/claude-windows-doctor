// The explain pages: one for every finding that the tool can emit, and no page for one that it cannot; each line says where it comes from.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";
import { IDS, PAGES, listPages, nearIds, pageFor } from "../src/explain.mjs";
import { explainJson, explainText } from "../src/report.mjs";

const sources = () => fs.readdirSync(path.join(ROOT, "src")).filter((n) => n.endsWith(".mjs")).filter((n) => n !== "explain.mjs").map((n) => fs.readFileSync(path.join(ROOT, "src", n), "utf8"));
const emitted = () => [...new Set(sources().flatMap((t) => [...t.matchAll(/\bf\("([a-z0-9]+(?:-[a-z0-9]+)*)", "(?:error|warning|note)"/g)].map((m) => m[1])))].sort();

test("a page for every id that the findings can emit, and no page for an id that they cannot", () => {
  assert.deepEqual([...IDS].sort(), emitted());
  assert.equal(new Set(IDS).size, IDS.length);
  assert.ok(IDS.length >= 27, `${IDS.length} pages`);
});

test("listPages has every id and title in page order, and no page detail", () => {
  assert.deepEqual(listPages(), PAGES.map(({ id, title }) => ({ id, title })));
});

test("every page has a title, what it means, lines of what Claude Code does that each say where they come from, a fix, and well-formed issue links", () => {
  for (const p of PAGES) {
    assert.ok(p.title && p.means && p.means.length > 30, p.id);
    assert.ok(p.does.length >= 1, `${p.id} says what Claude Code does`);
    for (const line of p.does) assert.match(line, /^[VDN]: /, `${p.id}: a line of "does" starts with V:, D: or N:`);
    assert.ok(p.fix.length >= 1, p.id);
    for (const i of p.issues) {
      assert.match(i.url, /^https:\/\/github\.com\/anthropics\/claude-code\/issues\/\d+$/, p.id);
      assert.equal(i.url.split("/").pop(), String(i.number));
      assert.ok(i.title.length > 5);
    }
  }
});

test("a line marked V says what was seen; a page that claims nothing verified is honest about it", () => {
  const page = pageFor("default-shell-scope");
  assert.deepEqual(page.does.map((d) => d.source), ["verified", "documented", "not verified"]);
  assert.match(page.does[0].text, /same with defaultShell "bash", "powershell" and "cmd"/);
  assert.equal(pageFor("index-lock").does[0].source, "not verified", "how Claude Code leaves the lock behind was not reproduced");
  assert.equal(pageFor("nope"), null);
});

test("explain's text and JSON: the title, the meaning, the three kinds of line, the fix and the threads", () => {
  const p = pageFor("git-bash-not-found");
  const t = explainText(p);
  assert.match(t, /^git-bash-not-found {3}Git for Windows is installed, but Claude Code does not find its bash\.exe\n/);
  assert.match(t, /What Claude Code does\n {2}- \(verified\) 1\. CLAUDE_CODE_GIT_BASH_PATH/);
  assert.match(t, /\nThe fix\n {2}- claude-windows-doctor fix --git-bash sets/);
  assert.match(t, /\nThe issue threads\n {2}#8674 {2}Claude Code VS Code Extension Fails to Detect Git Bash/);
  assert.match(t, /https:\/\/github\.com\/anthropics\/claude-code\/issues\/8674/);
  const none = explainText(pageFor("claude-multiple"));
  assert.match(none, /The issue threads: none found for this/);
  const j = explainJson(p);
  assert.deepEqual(Object.keys(j), ["ok", "id", "title", "means", "does", "fix", "issues"]);
  assert.deepEqual(j.does[0], { source: "verified", text: p.does[0].text });
});

test("the pages say what the binary was seen to do in the words of the README: the three places Git Bash is looked for, in order, and the mingw64 case", () => {
  const t = explainText(pageFor("git-bash-not-found"));
  assert.match(t, /1\. CLAUDE_CODE_GIT_BASH_PATH.*2\. C:\\Program Files\\Git\\bin\\bash\.exe, then C:\\Program Files \(x86\)\\Git\\bin\\bash\.exe.*3\. The first line that `where\.exe git` prints/s);
  assert.match(t, /fails for \.\.\.\\Git\\mingw64\\bin\\git\.exe/);
  assert.match(t, /Only the first line counts/);
  assert.match(explainText(pageFor("git-bash-path-project-settings")), /user settings .* was used .* the same value in the env of the project settings, and of the local settings, was not/s);
});

test("an exact id or its unique part is found; an ambiguous part and an unknown id are null", () => {
  assert.equal(pageFor("GIT-BASH-NOT-FOUND").id, "git-bash-not-found");
  assert.equal(pageFor("  Long-Paths ").id, "long-paths");
  assert.equal(pageFor("long").id, "long-paths");
  assert.equal(pageFor("distro").id, "wsl-no-distro");
  assert.equal(pageFor("autocrlf").id, "autocrlf");
  assert.equal(pageFor("git-bash"), null);
  assert.equal(pageFor("nosuch"), null);
  assert.equal(pageFor(""), null);
});

test("nearIds offers the ids that share a word", () => {
  assert.ok(nearIds("git-bash").includes("git-bash-not-found"));
  assert.ok(nearIds("claude").includes("claude-multiple"));
  assert.deepEqual(nearIds("zzz"), []);
});

test("plain words: no emoji, no superlatives, in any page", () => {
  const all = JSON.stringify(PAGES);
  assert.ok(!/\p{Extended_Pictographic}/u.test(all), "no emoji");
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing|awesome)\b/i.test(all));
});
