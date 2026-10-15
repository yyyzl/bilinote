const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const { fixture, base, output } = require("./verify-ui.cjs");

(async () => {
  const browser = await chromium.launch(launchOptions);
  const results = [];
  const errors = [];
  const external = [];
  try {
    await fs.mkdir(output, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await fixture(page);
    const navigate = async (route) =>
      page.evaluate((value) => {
        location.hash = "#" + value;
      }, route);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (!r.url().startsWith(base) && !r.url().startsWith("data:"))
        external.push(r.url());
    });
    await page.goto(base);
    await page.locator("[data-note-row]").first().waitFor();
    // 完成通知的元数据不是用户点击，切路由、聚焦或恢复可见均不应自动打开笔记。
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) =>
        cmd === "consume_notification_nav_target" ? "two" : invoke(cmd, args);
    });
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).hash, "");
    await page.getByRole("region", { name: "后台任务", exact: true }).waitFor();
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(200);
    assert.equal(new URL(page.url()).hash, "");
    await page.evaluate(() => window.__BINOTE_NOTIFICATION_CLICK__("two"));
    await page
      .getByRole("heading", { name: "如何建立持续有效的阅读习惯", exact: true })
      .waitFor();
    await navigate("/");
    await page.locator("[data-note-row]").first().waitFor();
    results.push("通知未点击不抢占路由；真实点击事件仍能打开笔记");
    await page
      .getByRole("searchbox", { name: "搜索笔记" })
      .fill("不存在的关键词");
    await page.getByRole("heading", { name: "没有找到相关笔记" }).waitFor();
    await page.getByRole("searchbox", { name: "搜索笔记" }).fill("");
    await page.getByLabel("B站视频链接", { exact: true }).fill("bad");
    await page.getByRole("button", { name: "开始转录", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    results.push("搜索空结果、解析失败错误弹窗");
    await page.getByLabel("B站视频链接", { exact: true }).fill("BV-new");
    await page.getByRole("button", { name: "开始转录", exact: true }).click();
    await page.waitForFunction(() =>
      window.__TEST_CALLS__.some((c) => c.cmd === "start_transcribe"),
    );
    await page.getByLabel("B站视频链接", { exact: true }).fill("BV-new");
    await page.getByRole("button", { name: "开始转录", exact: true }).click();
    await page.getByText("已在处理队列中", { exact: false }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_transcribe")
            .length,
      ),
      1,
    );
    await page.evaluate(() =>
      window.__TEST_EMIT__("transcribe:progress", {
        task_id: "task-new",
        message: "离线分流进度 P3 / 3",
      }),
    );
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page.getByText("离线分流进度 P3 / 3", { exact: true }).waitFor();
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await navigate("/");
    await page.getByText("2 个任务正在处理", { exact: true }).waitFor();
    results.push("重复提交去重、按任务分流、跨路由恢复转录队列");
    await page
      .getByRole("heading", { name: "如何建立持续有效的阅读习惯", exact: true })
      .click();
    await page
      .getByRole("button", { name: "生成AI 总结", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "正在生成" }).waitFor();
    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await navigate("/note/two");
    await page.getByRole("status").filter({ hasText: "正在生成" }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "start_summarize")
            .length,
      ),
      1,
    );
    await page.evaluate(() => {
      const t = window.__TEST_BACKEND__.tasks.find(
        (t) => t.task_id === "start_summarize",
      );
      t.status = "completed";
      const n = window.__TEST_BACKEND__.notes.find((n) => n.id === "two");
      n.summary = "## 新生成结果\n保留固定阅读时间。";
      n.preview = "固定阅读时间，并通过问题记录建立持续阅读习惯。";
    });
    await page
      .getByRole("heading", { name: "新生成结果", exact: true })
      .waitFor();
    results.push("总结任务启动、往返恢复、完成后刷新正文");
    await navigate("/note/missing");
    await page
      .getByRole("heading", { name: "笔记不存在或无法加载", exact: true })
      .waitFor();
    results.push("缺失笔记可返回，无无限加载");
    await page.evaluate(() => {
      window.__TEST_BACKEND__.delays.one = 400;
    });
    await navigate("/note/one");
    await page.waitForTimeout(80);
    await navigate("/note/two");
    await page
      .getByRole("heading", { name: "如何建立持续有效的阅读习惯", exact: true })
      .waitFor();
    await page.waitForTimeout(450);
    assert.equal(
      await page
        .getByRole("heading", {
          name: "如何建立持续有效的阅读习惯",
          exact: true,
        })
        .count(),
      1,
    );
    results.push("快速切换笔记时丢弃迟到的数据");
    await navigate("/settings");
    await page
      .getByRole("heading", { name: "视频转录", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "测试模型连接", exact: true })
      .click();
    await page.getByText("离线连接样例通过", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "测试语音识别连接", exact: true })
      .click();
    assert.equal(
      await page.getByText("离线连接样例通过", { exact: true }).count(),
      2,
    );
    await page.getByRole("button", { name: "Codex 订阅", exact: true }).click();
    await page
      .getByRole("button", { name: "测试 Codex 连接", exact: true })
      .click();
    await page.getByRole("button", { name: "3 个任务", exact: true }).click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "save_config").at(-1)
            .args.config.max_concurrent_transcribe,
      ),
      3,
    );
    results.push("三种连接测试传参、并发设置保存");
    await page.evaluate(() => {
      window.__TEST_BACKEND__.qrStatus = "expired";
    });
    await page.getByRole("button", { name: "扫码登录", exact: true }).click();
    await page
      .getByRole("button", { name: "刷新二维码", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "刷新二维码", exact: true }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    results.push("二维码过期、刷新、Escape 关闭");
    const polls = await page.evaluate(
      () => window.__TEST_CALLS__.filter((c) => c.cmd === "qrcode_poll").length,
    );
    await page.evaluate(() => {
      window.__TEST_BACKEND__.delays.qr = 300;
    });
    await page.getByRole("button", { name: "扫码登录", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2400);
    assert.equal(
      await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "qrcode_poll").length,
      ),
      polls,
    );
    results.push("关闭未完成的二维码请求后不重新启动轮询");
    await navigate("/");
    await page.getByRole("button", { name: "多选笔记", exact: true }).click();
    await page
      .getByRole("button", { name: "全选所有笔记", exact: true })
      .click();
    await page.getByRole("button", { name: "删除所选", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page
      .getByRole("heading", { name: "从第一条视频开始", exact: true })
      .waitFor();
    results.push("多选与确认删除、删除后刷新空库");
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(
      path.join(output, "flow-results.json"),
      JSON.stringify(
        { status: "passed", results, errors, externalRequests: external },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ status: "passed", results }));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
