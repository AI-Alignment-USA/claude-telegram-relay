/**
 * Weekly Security Audit
 *
 * Runs the checks from SECURITY_CHECKLIST.md automatically.
 * Sends a Telegram alert only if something fails.
 * Sends a brief "All clear" if everything passes.
 *
 * Schedule: Every Sunday at 8pm via PM2 cron.
 * Run manually: bun run examples/security-audit.ts
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { spawnSync } from "bun";

const PROJECT_ROOT = join(import.meta.dir, "..");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

// ============================================================
// INDIVIDUAL CHECKS
// ============================================================

async function checkBotRunning(): Promise<CheckResult> {
  const name = "Command Center is running";
  try {
    const proc = spawnSync(["C:/Users/crevi/.bun/bin/pm2.exe", "jlist"], {
      cwd: PROJECT_ROOT,
    });
    const output = new TextDecoder().decode(proc.stdout);
    const processes = JSON.parse(output);
    // The relay is now Claude Code Channels (not a PM2 process).
    // Check for command-center dashboard instead, which is the always-on PM2 service.
    const dashboard = processes.find(
      (p: any) => p.name === "command-center"
    );
    if (!dashboard) {
      return { name, passed: false, detail: "command-center not found in PM2" };
    }
    if (dashboard.pm2_env?.status !== "online") {
      return {
        name,
        passed: false,
        detail: `Status: ${dashboard.pm2_env?.status}`,
      };
    }
    return { name, passed: true, detail: "Online" };
  } catch (e: any) {
    return { name, passed: false, detail: `PM2 check failed: ${e.message}` };
  }
}

async function checkNoCrashes(): Promise<CheckResult> {
  const name = "No repeated crashes";
  try {
    const proc = spawnSync(["C:/Users/crevi/.bun/bin/pm2.exe", "jlist"], {
      cwd: PROJECT_ROOT,
    });
    const output = new TextDecoder().decode(proc.stdout);
    const processes = JSON.parse(output);
    // Check command-center (the always-on PM2 service)
    const dashboard = processes.find(
      (p: any) => p.name === "command-center"
    );
    if (!dashboard) {
      return { name, passed: false, detail: "command-center not found" };
    }
    const restarts = dashboard.pm2_env?.restart_time || 0;
    if (restarts > 5) {
      return {
        name,
        passed: false,
        detail: `command-center: ${restarts} restarts detected`,
      };
    }
    return { name, passed: true, detail: `command-center: ${restarts} restarts` };
  } catch (e: any) {
    return { name, passed: false, detail: e.message };
  }
}

async function checkUserIdEnforced(): Promise<CheckResult> {
  const name = "User ID enforced";
  try {
    const envContent = await readFile(join(PROJECT_ROOT, ".env"), "utf-8");
    const match = envContent.match(/TELEGRAM_USER_ID=(\S+)/);
    if (!match || !match[1]) {
      return { name, passed: false, detail: "TELEGRAM_USER_ID not set in .env" };
    }
    if (match[1].trim().length < 5) {
      return { name, passed: false, detail: "TELEGRAM_USER_ID looks invalid" };
    }
    return { name, passed: true, detail: "Set" };
  } catch (e: any) {
    return { name, passed: false, detail: `.env not readable: ${e.message}` };
  }
}

async function checkEnvNotCommitted(): Promise<CheckResult> {
  const name = ".env not committed";
  try {
    const proc = spawnSync(["git", "ls-files", "--error-unmatch", ".env"], {
      cwd: PROJECT_ROOT,
    });
    // Exit code 0 means .env IS tracked (bad)
    // Exit code 1 means .env is NOT tracked (good)
    if (proc.exitCode === 0) {
      return { name, passed: false, detail: ".env is tracked by git!" };
    }
    return { name, passed: true, detail: "Not tracked" };
  } catch {
    return { name, passed: true, detail: "Not tracked" };
  }
}

async function checkNothingUnexpectedStaged(): Promise<CheckResult> {
  const name = "No unknown files staged";
  try {
    const proc = spawnSync(["git", "diff", "--cached", "--name-only"], {
      cwd: PROJECT_ROOT,
    });
    const output = new TextDecoder().decode(proc.stdout).trim();
    if (output.length > 0) {
      const files = output.split("\n");
      return {
        name,
        passed: false,
        detail: `Staged files: ${files.join(", ")}`,
      };
    }
    return { name, passed: true, detail: "Nothing staged" };
  } catch (e: any) {
    return { name, passed: false, detail: e.message };
  }
}

async function checkGitignoreEntries(): Promise<CheckResult> {
  const name = ".env and profile.md in .gitignore";
  try {
    const gitignore = await readFile(join(PROJECT_ROOT, ".gitignore"), "utf-8");
    const hasEnv = gitignore.includes(".env");
    const hasProfile = gitignore.includes("config/profile.md");
    if (!hasEnv || !hasProfile) {
      const missing = [];
      if (!hasEnv) missing.push(".env");
      if (!hasProfile) missing.push("config/profile.md");
      return {
        name,
        passed: false,
        detail: `Missing from .gitignore: ${missing.join(", ")}`,
      };
    }
    return { name, passed: true, detail: "Both present" };
  } catch (e: any) {
    return { name, passed: false, detail: e.message };
  }
}

async function checkAntivirus(): Promise<CheckResult> {
  const name = "Antivirus active";
  try {
    // Query WMI for any registered antivirus product with real-time protection
    const proc = spawnSync(
      [
        "powershell.exe",
        "-Command",
        "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName,productState | ConvertTo-Json",
      ],
      { cwd: PROJECT_ROOT }
    );
    const output = new TextDecoder().decode(proc.stdout).trim();
    if (!output) {
      return { name, passed: false, detail: "No antivirus products found" };
    }

    const products = Array.isArray(JSON.parse(output))
      ? JSON.parse(output)
      : [JSON.parse(output)];

    // productState is a bitmask: bits 12-8 indicate real-time protection
    // 0x1000 (4096) = real-time enabled
    const active = products.filter((p: any) => {
      const state = p.productState;
      return (state & 0x1000) !== 0;
    });

    if (active.length > 0) {
      const names = active.map((p: any) => p.displayName).join(", ");
      return { name, passed: true, detail: `Active: ${names}` };
    }

    const allNames = products.map((p: any) => p.displayName).join(", ");
    return {
      name,
      passed: false,
      detail: `Installed but no real-time protection: ${allNames}`,
    };
  } catch (e: any) {
    return { name, passed: false, detail: `Check failed: ${e.message}` };
  }
}

async function checkEnvNotInCloud(): Promise<CheckResult> {
  const name = ".env excluded from OneDrive";
  try {
    // Check if project is inside OneDrive folder
    const projectPath = PROJECT_ROOT.replace(/\\/g, "/").toLowerCase();
    const inOneDrive = projectPath.includes("/onedrive/");
    if (!inOneDrive) {
      return { name, passed: true, detail: "Project not in OneDrive" };
    }
    // If in OneDrive, check if .env exists (it shouldn't sync)
    return {
      name,
      passed: false,
      detail: "Project is inside OneDrive folder — .env may be syncing",
    };
  } catch (e: any) {
    return { name, passed: false, detail: e.message };
  }
}

async function checkDependencies(): Promise<CheckResult> {
  const name = "Dependencies up to date";
  try {
    const proc = spawnSync(["bun", "outdated"], {
      cwd: PROJECT_ROOT,
    });
    const output = new TextDecoder().decode(proc.stdout).trim();
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    // bun outdated returns exit code 0 if everything is current
    if (proc.exitCode === 0 && !output.includes("│")) {
      return { name, passed: true, detail: "All current" };
    }
    // Count outdated packages
    const lines = output.split("\n").filter((l) => l.includes("│"));
    return {
      name,
      passed: false,
      detail: `${lines.length} outdated package(s)`,
    };
  } catch (e: any) {
    return { name, passed: true, detail: "Check skipped" };
  }
}

async function checkErrorLogs(): Promise<CheckResult> {
  const name = "No recent errors in logs";
  try {
    const logPath = join(PROJECT_ROOT, "logs", "command-center.error.log");
    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Check last 50 lines for recurring errors
    const recent = lines.slice(-50);
    const errorPatterns = recent.filter(
      (l) =>
        l.includes("Error") ||
        l.includes("error") ||
        l.includes("FATAL") ||
        l.includes("crash")
    );
    if (errorPatterns.length > 10) {
      return {
        name,
        passed: false,
        detail: `${errorPatterns.length} error lines in recent logs`,
      };
    }
    return { name, passed: true, detail: "Logs clean" };
  } catch {
    // No error log file = good
    return { name, passed: true, detail: "No error log" };
  }
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("Running weekly security audit...");

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const checks: CheckResult[] = await Promise.all([
    checkBotRunning(),
    checkNoCrashes(),
    checkUserIdEnforced(),
    checkEnvNotCommitted(),
    checkNothingUnexpectedStaged(),
    checkGitignoreEntries(),
    checkAntivirus(),
    checkEnvNotInCloud(),
    checkDependencies(),
    checkErrorLogs(),
  ]);

  const failures = checks.filter((c) => !c.passed);
  const passed = checks.filter((c) => c.passed);

  // Log all results locally
  for (const c of checks) {
    const icon = c.passed ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${c.name}: ${c.detail}`);
  }

  if (failures.length === 0) {
    // Everything passed — brief all-clear
    console.log("\nAll checks passed. Sending all-clear.");
    await sendTelegram(
      `All clear — weekly security audit passed (${passed.length}/${checks.length} checks).`
    );
  } else {
    // Something failed — send detailed alert
    console.log(`\n${failures.length} check(s) failed. Sending alert.`);

    const failLines = failures
      .map((f) => `  - *${f.name}:* ${f.detail}`)
      .join("\n");

    const message =
      `*Security Audit — ${failures.length} issue(s) found*\n\n` +
      `${failLines}\n\n` +
      `${passed.length}/${checks.length} checks passed.`;

    await sendTelegram(message);
  }
}

main();
