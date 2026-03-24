// PM2 wrapper -- Twitter nudge (9 AM follow-up for unanswered drafts)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/twitter-nudge.ts"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
