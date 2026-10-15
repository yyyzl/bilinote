// 任务是笔记库内的局部信息，展开不应成为一次页面导航。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const { fixture, base, output } = require("./verify-ui.cjs");

(async () => {
  const browser = await chromium.launch(launchOptions);
  const results = [];
  const errors = [];
  try {
    await fs.mkdir(output, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page);
    await page.goto(base + "/#/");
    await page.locator("[data-note-row]").first().waitFor();
    assert.equal(
      await page.getByRole("link", { name: /^任务中心/ }).count(),
      0,
      "任务不应作为独立导航页面",
    );
    const initial = await page.evaluate(() => ({
      url: location.href,
      history: history.length,
      overflow: document.body.style.overflow,
    }));
    await page.getByRole("searchbox", { name: "搜索笔记" }).fill("固定时间");
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    const region = page.getByRole("region", { name: "后台任务", exact: true });
    await region
      .getByRole("heading", { name: "正在整理的长视频", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page.getByRole("heading", { name: "笔记库", exact: true }).count(),
      1,
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        url: location.href,
        history: history.length,
        overflow: document.body.style.overflow,
      })),
      initial,
    );
    await page.getByRole("searchbox", { name: "搜索笔记" }).fill("Transformer");
    assert.equal(await page.locator("[data-note-row]").count(), 1);
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    assert.equal(
      await page.getByRole("searchbox", { name: "搜索笔记" }).inputValue(),
      "Transformer",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "查看任务", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        url: location.href,
        history: history.length,
        overflow: document.body.style.overflow,
      })),
      initial,
    );
    results.push(
      "展开收起不写路由/历史、不锁滚动，笔记库保持原位且搜索可继续使用",
    );
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page.screenshot({
      path: path.join(output, "inline-tasks-desktop.png"),
      animations: "disabled",
    });
    await page.locator("[data-note-row]").first().getByRole("heading").click();
    await page.getByRole("tab", { name: "AI 总结", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("button", { name: "查看任务", exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#/");
    assert.equal(await page.getByRole("dialog").count(), 0);
    results.push("展开期间可以直接打开笔记，一次后退返回笔记库并恢复后台任务");

    // 只有失败任务时仍保留入口，避免任务失败后无处重试。
    await page.evaluate(() => {
      const task = window.__TEST_BACKEND__.tasks[0];
      task.status = "failed";
      task.progress = "转录失败";
      task.error = "临时连接中断";
      location.hash = "#/settings";
    });
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await page
      .getByRole("link", { name: "返回笔记库", exact: true })
      .first()
      .click();
    await page.getByText("1 个任务未完成", { exact: true }).waitFor();
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await region
      .getByRole("button", { name: "重试任务", exact: true })
      .waitFor();
    await region.getByText("临时连接中断", { exact: true }).waitFor();
    results.push("只有失败任务也能在库内查看原因与重试");

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator(".mobile-nav").count(), 0);
    await page
      .getByRole("banner")
      .getByRole("link", { name: "设置", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(output, "inline-tasks-mobile.png"),
      animations: "disabled",
      fullPage: true,
    });
    results.push("手机顶部设置可达，任务原位单列且无横向溢出");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "inline-task-results.json"),
      JSON.stringify({ results, runtimeErrors: errors }, null, 2),
    );
    console.log(JSON.stringify({ results, runtimeErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
