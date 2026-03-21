// PM2 wrapper — daily tweet drafts
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/twitter-drafts.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
