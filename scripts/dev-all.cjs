const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoDir = path.resolve(__dirname, "..");
const backendDir = path.join(repoDir, "backend");
const legacyBackendDir = path.resolve(repoDir, "..", "backend");

const children = [];
let shuttingDown = false;

const isWindows = process.platform === "win32";
const pythonCommand = isWindows ? "python" : "python3";
const frontendApiUrl = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
const frontendApiProxyTarget =
  process.env.SM2_API_PROXY_TARGET ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:8000";
const frontendEnv = {
  ...process.env,
  NEXT_PUBLIC_API_URL: frontendApiUrl,
  SM2_API_PROXY_TARGET: frontendApiProxyTarget,
};

function warnAboutLegacyBackend() {
  if (!fs.existsSync(legacyBackendDir)) {
    return;
  }

  console.warn("[dev] Legacy backend folder detected at:");
  console.warn(`[dev]   ${legacyBackendDir}`);
  console.warn("[dev] This launcher ignores that copy and uses apps/frontend/backend as the single source of truth.");
}

function runCommandCapture(command, args, cwd = repoDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: typeof result.status === "number" ? result.status : 0,
    error: result.error || null,
  };
}

function getListeningPids(port) {
  if (isWindows) {
    const query = [
      "-NoProfile",
      "-Command",
      `$pids = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($pids) { $pids | ForEach-Object { $_ } }`,
    ];
    const result = runCommandCapture("powershell", query);
    if (result.error || result.status !== 0) {
      return [];
    }

    return [...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0),
    )];
  }

  const result = runCommandCapture("lsof", ["-ti", `tcp:${port}`]);
  if (result.error || result.status !== 0) {
    return [];
  }

  return [...new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  )];
}

function getProcessCommandLine(pid) {
  if (isWindows) {
    const result = runCommandCapture(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$process = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -First 1 -ExpandProperty CommandLine; if ($process) { $process }`,
      ],
    );

    if (result.error || result.status !== 0) {
      return "";
    }

    return result.stdout.trim();
  }

  const result = runCommandCapture("ps", ["-p", String(pid), "-o", "command="]);
  if (result.error || result.status !== 0) {
    return "";
  }

  return result.stdout.trim();
}

function stopProcess(pid, label) {
  if (isWindows) {
    console.log(
      `[dev] Stopping existing ${label} process on port ${label === "frontend" ? 3000 : 8000} (PID ${pid})...`,
    );
    const result = runCommandCapture("taskkill", ["/PID", String(pid), "/T", "/F"]);
    if (result.error || result.status !== 0) {
      console.warn(`[dev] Unable to stop PID ${pid} for ${label}.`);
    }
    return;
  }

  console.log(`[dev] Stopping existing ${label} process (PID ${pid})...`);
  runCommandCapture("kill", ["-9", String(pid)]);
}

function cleanupPort(port, label, matchers = []) {
  const pids = getListeningPids(port);
  if (!pids.length) return;

  const normalizedMatchers = matchers.map((matcher) => String(matcher).toLowerCase());

  pids.forEach((pid) => {
    const commandLine = getProcessCommandLine(pid);
    const normalizedCommandLine = commandLine.toLowerCase();
    const shouldStop =
      normalizedMatchers.length === 0 ||
      normalizedMatchers.some((matcher) => normalizedCommandLine.includes(matcher));

    if (!shouldStop) {
      console.warn(
        `[dev] Port ${port} is already in use by PID ${pid}. Leaving it running because it does not look like a stale SM2 process.`,
      );
      return;
    }

    stopProcess(pid, label);
  });
}

function spawnProcess(
  label,
  command,
  args,
  cwd,
  { terminateOnExit = true, env = process.env } = {},
) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env,
  });

  children.push(child);

  child.on("error", (error) => {
    console.error(`[dev] ${label} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown || !terminateOnExit) return;
    console.log(
      `[dev] ${label} exited${signal ? ` with signal ${signal}` : ` with code ${code}`}.`,
    );
    shutdown(code ?? 0);
  });

  return child;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch (error) {
        console.warn(`[dev] Failed to stop child process: ${error.message}`);
      }
    }
  }

  setTimeout(() => process.exit(exitCode), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function run() {
  warnAboutLegacyBackend();
  console.log("[dev] Starting SM2 Racing repo workspace...");
  console.log("[dev] Frontend will run at http://localhost:3000");
  console.log("[dev] Backend will run at http://127.0.0.1:8000");
  console.log(`[dev] Canonical backend: ${backendDir}`);
  console.log(`[dev] Frontend API base URL: ${frontendEnv.NEXT_PUBLIC_API_URL}`);
  console.log(`[dev] Frontend API proxy target: ${frontendEnv.SM2_API_PROXY_TARGET}`);
  console.log("[dev] Cleaning up any stale workspace servers on ports 3000 and 8000...");
  cleanupPort(8000, "backend", ["uvicorn", "app.main:app"]);
  cleanupPort(3000, "frontend", ["apps\\frontend", "next\\dist\\bin\\next"]);
  console.log("[dev] Building frontend first so the browser gets stable CSS and routes...");

  const backend = spawnProcess(
    "backend",
    pythonCommand,
    ["-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
    backendDir,
  );

  const build = spawnProcess("frontend build", "cmd.exe", ["/d", "/s", "/c", "npm run build"], repoDir, {
    terminateOnExit: false,
    env: frontendEnv,
  });
  const buildResult = await waitForExit(build);

  if (buildResult.code !== 0) {
    console.error("[dev] Frontend build failed. Check the log above.");
    shutdown(buildResult.code || 1);
    return;
  }

  console.log("[dev] Frontend build completed. Starting the production frontend server...");
  spawnProcess("frontend", "cmd.exe", ["/d", "/s", "/c", "npm run start"], repoDir, {
    env: frontendEnv,
  });

  void backend;
}

run().catch((error) => {
  console.error("[dev] Repo launcher crashed:", error);
  shutdown(1);
});
