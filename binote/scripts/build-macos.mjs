import { spawnSync } from "node:child_process";
import process from "node:process";

const signed = process.argv.includes("--signed");

if (process.platform !== "darwin") {
  console.error("macOS .app/.dmg 只能在 macOS 环境打包。");
  console.error("请在 Mac 上运行 `npm run mac:build`，或在 GitHub Actions 手动触发 Build macOS 工作流。");
  process.exit(1);
}

const args = [
  "tauri",
  "build",
  "--ci",
  "--target",
  "universal-apple-darwin",
  "--bundles",
  "app,dmg",
];

if (!signed) {
  args.push("--no-sign");
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, args, { stdio: "inherit" });

process.exit(result.status ?? 1);
