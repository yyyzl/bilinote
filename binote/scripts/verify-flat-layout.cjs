const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const { fixture, base, output } = require("./verify-ui.cjs");

(async () => {
  const browser = await chromium.launch(launchOptions);
  const errors = [];
  const results = [];
  try {
    await fs.mkdir(output, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await fixture(page);
    await page.goto(base + "/#/");
    await page.locator("[data-note-row]").first().waitFor();
    assert.equal(
      await page.locator(".app-sidebar").count(),
      0,
      "只有一个内容库时不保留侧栏",
    );
    const header = page.getByRole("banner");
    await header.getByRole("link", { name: "设置", exact: true }).waitFor();
    assert.equal(await page.getByRole("navigation").count(), 0);
    const mainBounds = await page.getByRole("main").boundingBox();
    assert.ok(
      Math.abs(mainBounds.x - (1440 - mainBounds.width) / 2) < 2,
      "主区居中而非保留侧栏偏移",
    );
    await page.screenshot({
      path: path.join(output, "flat-library-desktop.png"),
      animations: "disabled",
    });
    results.push("桌面无侧栏与重复库导航，顶部品牌/设置，主体居中");

    await header.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByLabel("模型名称", { exact: true }).waitFor();
    await header.getByRole("link", { name: "返回笔记库", exact: true }).click();
    await page.locator("[data-note-row]").first().getByRole("heading").click();
    await page.getByRole("tab", { name: "AI 总结", exact: true }).waitFor();
    await page.getByRole("link", { name: "返回笔记库", exact: true }).click();
    await page.locator("[data-note-row]").first().waitFor();
    results.push("设置与阅读都有明确返回入口，无需多级切换");

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator(".mobile-nav").count(), 0);
    await header.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByLabel("模型名称", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(output, "flat-settings-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await header.getByRole("link", { name: "返回笔记库", exact: true }).click();
    await page.locator("[data-note-row]").first().waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(output, "flat-library-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    results.push("手机无底部导航，顶部设置/返回可用且无横向溢出");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "flat-layout-results.json"),
      JSON.stringify({ results, runtimeErrors: errors }, null, 2),
    );
    console.log(JSON.stringify({ results, runtimeErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
