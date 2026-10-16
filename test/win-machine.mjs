// A clean pretend Windows machine for the tests of the findings, the reports and the commands: Git for Windows at C:\Program Files\Git, a
// native claude on PATH, PowerShell 5.1, long paths on, UTF-8 in the console, one ordinary WSL distribution, an empty user environment.
// A test spoils one thing and looks at what is said.
import { fakeMachine, SYSTEM_FILES } from "./machine.mjs";
import { collectWindows } from "../src/check.mjs";
import { regUserEnv, REAL_KEY } from "../src/winenv.mjs";

export const HOME = "C:\\Users\\me";
export const PROJECT = "C:\\work\\shop";
export const NATIVE = `${HOME}\\.local\\bin\\claude.exe`;
export const utf16 = (text) => Buffer.from(text, "utf16le");
const out = (stdout, status = 0) => ({ status, stdout, stderr: "" });

export const UBUNTU = "  NAME      STATE           VERSION\r\n* Ubuntu    Running         2\r\n";
export const POLICY = (o = {}) => `MachinePolicy=${o.machine || "Undefined"}\r\nUserPolicy=${o.user || "Undefined"}\r\nProcess=Undefined\r\nCurrentUser=${o.currentUser || "RemoteSigned"}\r\nLocalMachine=${o.localMachine || "Undefined"}\r\n`;

/**
 * options (all optional):
 *   env, files, dirs, texts, versions, registry   merged into the clean machine's (registry values are [type, value])
 *   commands    replaces handlers by name (git, cmd, powershell, wsl, tasklist, bash)
 *   noGit       true leaves out Git for Windows at C:\Program Files\Git (and git.exe on PATH)
 *   noClaude    true leaves out the native claude
 */
export function winMachine(o = {}) {
  const gitRoot = "C:\\Program Files\\Git";
  const files = [...SYSTEM_FILES, ...(o.noGit ? [] : [`${gitRoot}\\bin\\bash.exe`, `${gitRoot}\\cmd\\git.exe`, `${gitRoot}\\usr\\bin\\bash.exe`]), ...(o.noClaude ? [] : [NATIVE]), ...(o.files || [])];
  const registry = {
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem": { LongPathsEnabled: ["REG_DWORD", "0x1"] },
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage": { OEMCP: ["REG_SZ", "437"], ACP: ["REG_SZ", "1252"] },
    [REAL_KEY]: {},
    ...(o.registry || {}),
  };
  const commands = {
    git: (args) => {
      if (args[0] === "--version") return out("git version 2.55.0.windows.3\n");
      const key = args[args.length - 1];
      if (key === "core.autocrlf") return { status: 1, stdout: "", stderr: "" };
      if (key === "core.longpaths") return out("file:C:/Users/me/.gitconfig\ttrue\n");
      return { status: 1, stdout: "", stderr: "" };
    },
    cmd: (args) => {
      const line = String(args[args.length - 1]);
      if (/npm config get prefix/.test(line)) return out(`${HOME}\\AppData\\Roaming\\npm\r\n`);
      if (/npm --version/.test(line)) return out("10.9.0\r\n");
      if (/chcp/.test(line)) return out("Active code page: 65001\r\n");
      return { status: 1, stdout: "", stderr: "" };
    },
    powershell: () => out(POLICY()),
    pwsh: () => out(POLICY()),
    wsl: () => ({ status: 0, stdout: utf16(UBUNTU) }),
    tasklist: () => out("INFO: No tasks are running which match the specified criteria.\r\n"),
    bash: () => out(""),
    ...(o.commands || {}),
  };
  return fakeMachine({
    env: { Path: `${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows`, SystemRoot: "C:\\Windows", USERPROFILE: HOME, APPDATA: `${HOME}\\AppData\\Roaming`, LOCALAPPDATA: `${HOME}\\AppData\\Local`, ...(o.env || {}) },
    cwd: PROJECT,
    home: HOME,
    files,
    dirs: [PROJECT, ...(o.dirs || [])],
    texts: o.texts || {},
    versions: { [NATIVE]: "2.1.299 (Claude Code)", ...(o.versions || {}) },
    registry,
    commands,
    nodeVersion: o.nodeVersion,
    mtimes: o.mtimes,
  });
}

/** collectWindows on a machine, with the registry layer of that machine. */
export function collect(sys, project = PROJECT) {
  return collectWindows(sys, { project, userEnv: regUserEnv(sys), dir: "C:\\Temp\\cwd-test" });
}

export const idsOf = (facts) => facts.findings.map((f) => f.id);
