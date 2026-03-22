// PM2 wrapper — COO end-of-day summary
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/coo-briefing.ts", "eod"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
