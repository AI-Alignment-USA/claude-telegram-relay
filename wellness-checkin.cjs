// PM2 wrapper — Wellness weekly check-in (Wed 8pm PT)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/wellness-checkin.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
