const fs = require("node:fs");
const path = require("node:path");

// 此处固定历史证书而非别名或文件名，避免 CI 换钥后仍发布无法覆盖升级的 APK。
const expected = fs.readFileSync(path.join(__dirname,
  "../../.github/android-signing-certificate.sha256"), "utf8").trim().toLowerCase();
const output = fs.readFileSync(0, "utf8");
const certificates = output.split(/\r?\n/).filter((line) =>
  /^Signer #\d+ certificate SHA-256 digest:/.test(line));
const digest = certificates.length === 1
  ? /^Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/i.exec(certificates[0])?.[1].toLowerCase()
  : undefined;

if (!/^[a-f0-9]{64}$/.test(expected) || !/^Verifies\r?$/m.test(output) || digest !== expected) {
  console.error("Android signing certificate must match legacy 0.4.1; refusing release.");
  process.exit(1);
}

console.log("PASS: Android signing certificate matches legacy 0.4.1.");
