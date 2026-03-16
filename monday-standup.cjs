// PM2 wrapper — Monday standup (9:30am PT every Monday)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/monday-standup.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
