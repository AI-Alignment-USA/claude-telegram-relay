// PM2 wrapper — News Room weekly deep dive
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/newsroom-digest.ts", "weekly"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
