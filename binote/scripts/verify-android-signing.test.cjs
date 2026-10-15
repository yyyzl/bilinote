const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

// 从本机实际 0.4.1 / 0.3.0 APK 核验的历史证书，不从待测配置反推期望值。
const legacy = "ed3941864428890cd565f73a36b38e0358cff5aa2aece89a239fddd0788a1f48";
const matching = `Verifies\nSigner #1 certificate SHA-256 digest: ${legacy}\n`;
const verify = (input) => spawnSync(process.execPath, [
  path.join(__dirname, "verify-android-signing.cjs"),
], { input, encoding: "utf8", timeout: 5000, windowsHide: true });

test("允许原 0.4.1 证书，接受十六进制大小写", { timeout: 10000 }, () => {
  assert.equal(verify(matching).status, 0);
  assert.equal(verify(matching.replace(legacy, legacy.toUpperCase())).status, 0);
});

test("拒绝临时或替换证书", { timeout: 10000 }, () => {
  const result = verify(matching.replace(legacy, "0".repeat(64)));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0\.4\.1/);
});

test("拒绝未验证、缺失或畸形证书结果", { timeout: 10000 }, () => {
  for (const input of ["", matching.replace("Verifies", "DOES NOT VERIFY"),
    matching.replace(legacy, "invalid")]) {
    assert.equal(verify(input).status, 1);
  }
});

test("拒绝新增签名者，避免改变旧版的签名集合", { timeout: 10000 }, () => {
  assert.equal(verify(`${matching}Signer #2 certificate SHA-256 digest: ${"1".repeat(64)}\n`).status, 1);
});

test("公钥摘要不能冒充证书摘要", { timeout: 10000 }, () => {
  assert.equal(verify(matching.replace("certificate SHA-256", "public key SHA-256")).status, 1);
});
