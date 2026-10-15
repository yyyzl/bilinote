// 限制单元测试进程总时长，避免后台测试无限等待。
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const child = spawn("cargo", ["test", "--lib", ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, "../src-tauri"),
  stdio: "inherit",
  windowsHide: true,
});
const timer = setTimeout(() => {
  process.stderr.write("单元测试超过 60 秒，已停止。\n");
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  else child.kill("SIGKILL");
  process.exitCode = 124;
}, 60000);
child.on("exit", (code) => {
  clearTimeout(timer);
  process.exitCode = process.exitCode || code || 0;
});
child.on("error", (error) => {
  clearTimeout(timer);
  process.stderr.write(error.message);
  process.exitCode = 1;
});
