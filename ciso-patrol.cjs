// PM2 wrapper — CISO nightly patrol (11pm PT)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/ciso-patrol.ts", "patrol"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
