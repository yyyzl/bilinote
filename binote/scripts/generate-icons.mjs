import { copyFileSync, cpSync, existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const source = path.join(root, "app-icon.svg");
const output = path.join(root, "src-tauri", "icons");
// Tauri 会保留已有 Android 文件，先在新目录生成，再统一覆盖目标资源。
const staging = mkdtempSync(path.join(tmpdir(), "binote-icons-"));

// 所有平台共用同一份 SVG，避免旧尺寸图标残留。
for (const options of [
  ["--ios-color", "#fffaf1"],
  ["--png", "16", "--png", "64", "--png", "1024"],
]) {
  const result = spawnSync(
    process.execPath,
    [cli, "icon", source, "--output", staging, ...options],
    { cwd: root, stdio: "inherit", timeout: 60_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

cpSync(staging, output, { recursive: true });
copyFileSync(path.join(output, "1024x1024.png"), path.join(root, "app-icon.png"));

// 已初始化的 Android 工程同步更新；CI 继续使用现有同步步骤。
const androidResources = path.join(root, "src-tauri/gen/android/app/src/main/res");
if (existsSync(androidResources)) {
  cpSync(path.join(output, "android"), androidResources, { recursive: true });
}
