// PM2 wrapper -- Memory flush (11pm ET daily)
// Analyzes recent conversation context, extracts durable facts,
// updates memory files, and commits/pushes changes.
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/memory-flush.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));

// PM2 cron: run at 11pm ET daily
module.exports = {
  cron_restart: "0 23 * * *",
};
