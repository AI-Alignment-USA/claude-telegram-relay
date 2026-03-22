// PM2 wrapper — Polymarket weekly check-in (Sunday 6pm PT)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/polymarket-checkin.ts"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
