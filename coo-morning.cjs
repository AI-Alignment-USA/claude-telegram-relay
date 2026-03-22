// PM2 wrapper — COO morning briefing
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/coo-briefing.ts", "morning"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
