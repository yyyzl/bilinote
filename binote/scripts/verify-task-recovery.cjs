const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const { fixture, base, output } = require("./verify-ui.cjs");

(async () => {
  const browser = await chromium.launch(launchOptions);
  const results = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await fixture(page);
    await page.addInitScript(() => {
      window.__RECOVERY_FAIL__ = false;
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if (cmd === "list_tasks") {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (window.__RECOVERY_FAIL__) throw "任务列表暂时不可用";
        }
        if (cmd === "parse_link" && args.input.includes("BV3demo"))
          return "BV3demo";
        return invoke(cmd, args);
      };
    });
    await page.goto(base + "/#/");
    await page.locator("[data-note-row]").first().waitFor();
    await page.getByLabel("B站视频链接", { exact: true }).fill("BV3demo");
    assert.equal(
      await page.locator('button[type="submit"]').isDisabled(),
      true,
      "任务恢复之前不允许再次提交视频",
    );
    await page.getByLabel("B站视频链接", { exact: true }).press("Enter");
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_transcribe")
            .length,
      ),
      0,
    );
    await page.getByRole("button", { name: "开始转录", exact: true }).click();
    await page.getByText("已在处理队列中", { exact: false }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_transcribe")
            .length,
      ),
      0,
    );
    results.push("库内恢复前按钮和Enter均不提交，恢复后复用去重判断");

    await page.evaluate(() => {
      window.__TEST_BACKEND__.tasks.push({
        task_id: "summary-existing",
        kind: "summarize",
        note_id: "two",
        status: "running",
        progress: "已有总结正在生成",
      });
      location.hash = "#/note/two";
    });
    await page
      .getByRole("heading", { name: "如何建立持续有效的阅读习惯", exact: true })
      .waitFor();
    const summaryButton = page.getByRole("button", {
      name: "生成AI 总结",
      exact: true,
    });
    assert.equal(
      await summaryButton.isDisabled(),
      true,
      "笔记内容先返回时也须等待任务恢复",
    );
    await page
      .getByRole("status")
      .filter({ hasText: "已有总结正在生成" })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_summarize")
            .length,
      ),
      0,
    );
    results.push("阅读内容可先显示，恢复完成前不重复启动已有总结");

    await page.evaluate(() => {
      window.__RECOVERY_FAIL__ = true;
      location.hash = "#/note/one";
    });
    await page
      .getByRole("heading", { name: "后台任务暂时无法恢复", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "重新生成", exact: true })
        .first()
        .isDisabled(),
      true,
    );
    await page.getByRole("tab", { name: "原始转录", exact: true }).click();
    await page
      .getByText("查询、键和值通过加权计算形成上下文。", { exact: false })
      .waitFor();
    await page.evaluate(() => {
      window.__RECOVERY_FAIL__ = false;
    });
    await page
      .getByRole("button", { name: "重新读取任务", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "后台任务暂时无法恢复", exact: true })
      .waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: "思维导图", exact: true }).click();
    await page
      .getByRole("button", { name: "重新生成", exact: true })
      .first()
      .click();
    await page.waitForFunction(() =>
      window.__TEST_CALLS__.some((c) => c.cmd === "start_mindmap"),
    );
    results.push("恢复失败保留阅读、禁止生成，原位重试后正常生成导图");

    await page.evaluate(() => {
      location.hash = "#/settings";
    });
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await page.evaluate(() =>
      window.__BINOTE_RECEIVE_SHARE__("https://www.bilibili.com/video/BV3demo"),
    );
    await page.getByRole("heading", { name: "笔记库", exact: true }).waitFor();
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_transcribe")
            .length,
      ),
      0,
    );
    await page.getByText("已在处理队列中", { exact: false }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_transcribe")
            .length,
      ),
      0,
    );
    results.push("分享先保留队列，恢复完成后按已有任务去重");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, "task-recovery-results.json"),
      JSON.stringify({ results }, null, 2),
    );
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
