// PM2 wrapper — Command Center Dashboard (localhost only)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "dashboard/server.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
