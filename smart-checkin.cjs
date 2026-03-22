// PM2 wrapper — spawns bun for smart check-in with .env loaded
const { spawn } = require("child_process");
const path = require("path");

const child = spawn("bun", ["run", "examples/smart-checkin.ts"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});

child.on("exit", (code) => process.exit(code || 0));
