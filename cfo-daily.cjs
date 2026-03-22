// PM2 wrapper — CFO daily sales report
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/cfo-reports.ts", "daily"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
