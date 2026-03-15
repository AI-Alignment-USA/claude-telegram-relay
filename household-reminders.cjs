// PM2 wrapper — Household daily reminders
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/household-reminders.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
