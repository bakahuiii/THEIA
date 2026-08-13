import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import {
  projectRoot,
  stopPreviousTheiaDevProcesses,
} from "./dev-processes.mjs";

await stopPreviousTheiaDevProcesses();

const vite = resolve(projectRoot, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [vite, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: ["inherit", "pipe", "pipe"],
  windowsHide: false,
});

// Vite's output is still shown, with terminal bell characters removed.
const relay = (chunk) => process.stdout.write(String(chunk).replace(/\x07/g, ""));
child.stdout?.on("data", relay);
child.stderr?.on("data", relay);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
