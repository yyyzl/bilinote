// Source of truth is android/, never the ignored Tauri generation directory.
const fs = require("node:fs");
const path = require("node:path");
const project = path.resolve(__dirname, "..");

function syncAndroid(androidDir = path.join(project, "src-tauri/gen/android")) {
  const gradlePath = path.join(androidDir, "app/build.gradle.kts");
  if (!fs.existsSync(gradlePath)) {
    throw new Error("Android project missing. Run npx tauri android init first.");
  }
  const source = path.join(project, "android");
  fs.cpSync(path.join(source, "app/src"), path.join(androidDir, "app/src"), { recursive: true });
  fs.copyFileSync(path.join(source, "binote.gradle.kts"), path.join(androidDir, "app/binote.gradle.kts"));
  const apply = 'apply(from = "binote.gradle.kts")';
  const gradle = fs.readFileSync(gradlePath, "utf8");
  if (!gradle.includes(apply)) fs.appendFileSync(gradlePath, "\n" + apply + "\n");
}
module.exports = { syncAndroid };
if (require.main === module) {
  try { syncAndroid(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
