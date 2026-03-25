// PM2 wrapper — Newsroom afternoon digest
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/newsroom-digest.ts", "daily", "afternoon"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
