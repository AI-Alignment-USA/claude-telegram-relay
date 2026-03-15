// PM2 wrapper — Education weekly digest
const { spawn } = require("child_process");
const child = spawn("bun", ["run", "src/workers/education-digest.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: Object.assign({}, process.env),
});
child.on("exit", (code) => process.exit(code || 0));
