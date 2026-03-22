// PM2 wrapper — spawns bun for security audit with .env loaded
const { spawn } = require("child_process");
const path = require("path");

const child = spawn("bun", ["run", "examples/security-audit.ts"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});

child.on("exit", (code) => process.exit(code || 0));
