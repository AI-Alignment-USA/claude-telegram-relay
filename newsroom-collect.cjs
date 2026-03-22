// PM2 wrapper — News Room RSS collection
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/newsroom-collect.ts"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
