// PM2 wrapper — CFO weekly financial report
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/cfo-reports.ts", "weekly"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
