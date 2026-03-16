// PM2 wrapper — CISO morning brief (6:30am PT, only if issues found)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/ciso-patrol.ts", "brief"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
