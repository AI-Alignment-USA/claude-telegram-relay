// PM2 wrapper — CISO weekly security report (Mon 6:30am PT)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/ciso-patrol.ts", "weekly"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
