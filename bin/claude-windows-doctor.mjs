#!/usr/bin/env node
// claude-windows-doctor: which shell Claude Code's Bash tool gets on Windows and why, every claude on PATH, and the setup problems
// behind the common Windows issues. All the work lives in src/cli.mjs; run `claude-windows-doctor --help` for the commands.
import { main } from "../src/cli.mjs";

// `claude-windows-doctor check | head` closes the pipe early: that is not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
