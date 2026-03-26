// PM2 wrapper — Telegram Relay (always-on Telegram poller)
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/relay.ts"], {
  cwd: __dirname,
  stdio: "pipe",
  windowsHide: true,
  env: Object.assign({}, process.env),
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("exit", (code) => process.exit(code || 0));
