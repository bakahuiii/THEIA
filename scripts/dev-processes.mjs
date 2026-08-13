import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(scriptDirectory, "..");

export async function stopPreviousTheiaDevProcesses() {
  if (process.platform !== "win32") return [];

  const discoveryScript = [
    "$root = $env:THEIA_DEV_ROOT",
    "$currentProcessId = [int]$env:THEIA_DEV_CURRENT_PID",
    "$targets = @(Get-CimInstance Win32_Process | Where-Object {",
    "  $commandLine = $_.CommandLine",
    "  $executablePath = $_.ExecutablePath",
    "  if ($_.ProcessId -eq $currentProcessId) { return $false }",
    "  if (-not $commandLine -and -not $executablePath) { return $false }",
    "  $insideProject = ($commandLine -and $commandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($executablePath -and $executablePath.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)",
    "  $isDevLauncher = $commandLine -match '(?i)[\\\\/]scripts[\\\\/]dev\\.mjs'",
    "  $isVite = ($commandLine -match '(?i)[\\\\/]vite[\\\\/]bin[\\\\/]vite\\.js') -and ($commandLine -notmatch '(?i)(?:^|[\\s\"''])build(?:[\\s\"'']|$)')",
    "  $isElectronMain = $commandLine -match '(?i)electron[\\\\/]main\\.mjs'",
    "  return $insideProject -and ($isDevLauncher -or $isVite -or $isElectronMain)",
    "} | Select-Object -ExpandProperty ProcessId -Unique)",
    "if ($targets.Count -gt 0) { $targets -join ',' }",
  ].join("\n");

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", discoveryScript],
      {
        env: {
          ...process.env,
          THEIA_DEV_ROOT: projectRoot,
          THEIA_DEV_CURRENT_PID: String(process.pid),
        },
        windowsHide: true,
      },
    ));
  } catch {
    console.warn("[THEIA] Could not inspect previous development processes.");
    return [];
  }

  const processIds = stdout
    .trim()
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isSafeInteger(value) && value > 0);

  for (const processId of processIds) {
    try {
      await execFileAsync(
        "taskkill.exe",
        ["/PID", String(processId), "/T", "/F"],
        { windowsHide: true },
      );
    } catch {
      // A parent process may already have stopped this matching child tree.
    }
  }

  if (processIds.length > 0) {
    console.log(
      `[THEIA] Stopped ${processIds.length} previous development process${processIds.length === 1 ? "" : "es"}.`,
    );
  }
  return processIds;
}
