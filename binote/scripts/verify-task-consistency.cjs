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
      window.__TEST_BACKEND__.tasks.push({
        task_id: "failed-old",
        kind: "summarize",
        note_id: "one",
        status: "failed",
        progress: "生成失败",
        error: "旧失败记录",
      });
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if (window.__PAUSE_START__ === cmd) {
          const result = await invoke(cmd, args);
          window.__RETRY_STARTED__ = true;
          await new Promise((resolve) => {
            window.__RELEASE_RETRY__ = resolve;
          });
          return result;
        }
        if (cmd === "get_note" && window.__HOLD_NEXT_READ__) {
          window.__HOLD_NEXT_READ__ = false;
          const snapshot = await invoke(cmd, args);
          window.__READ_HELD__ = true;
          await new Promise((resolve) => {
            window.__RELEASE_READ__ = resolve;
          });
          return snapshot;
        }
        return invoke(cmd, args);
      };
    });
    const reopenLibrary = async () => {
      await page.evaluate(() => {
        location.hash = "#/settings";
      });
      await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
      await page.getByRole("link", { name: "返回笔记库", exact: true }).click();
      await page.getByRole("button", { name: "查看任务", exact: true }).click();
    };
    await page.goto(base + "/#/");
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page
      .locator(".task-item")
      .filter({ hasText: "旧失败记录" })
      .getByRole("button", { name: "移除记录", exact: true })
      .click();
    await reopenLibrary();
    assert.equal(
      await page.getByText("旧失败记录", { exact: true }).count(),
      0,
      "移除的失败记录不应在返回笔记库后复活",
    );
    results.push("移除失败记录同步恢复源，跨页后不再出现");

    await page.evaluate(() =>
      window.__TEST_BACKEND__.tasks.push({
        task_id: "failed-retry",
        kind: "summarize",
        note_id: "one",
        status: "failed",
        progress: "生成失败",
        error: "待重试的旧记录",
      }),
    );
    await reopenLibrary();
    await page
      .locator(".task-item")
      .filter({ hasText: "待重试的旧记录" })
      .getByRole("button", { name: "重试任务", exact: true })
      .click();
    await page.waitForFunction(() =>
      window.__TEST_BACKEND__.tasks.some(
        (task) => task.task_id === "start_summarize",
      ),
    );
    await page.evaluate(() => {
      window.__TEST_BACKEND__.tasks.find(
        (task) => task.task_id === "start_summarize",
      ).status = "completed";
    });
    await reopenLibrary();
    assert.equal(
      await page.getByText("待重试的旧记录", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(() =>
        window.__TEST_BACKEND__.tasks.some(
          (task) => task.task_id === "failed-retry",
        ),
      ),
      false,
    );
    results.push("重试成功替换旧失败记录，跨页恢复不再重报失败");

    await page.evaluate(() => {
      const tasks = window.__TEST_BACKEND__.tasks;
      tasks.splice(
        0,
        tasks.length,
        ...tasks.filter((task) => task.task_id !== "start_summarize"),
      );
    });
    await page.getByRole("link", { name: "BiNote 首页", exact: true }).click();
    await page.locator("[data-note-row]").first().getByRole("heading").click();
    await page
      .getByRole("button", { name: "重新生成", exact: true })
      .first()
      .click();
    await page.getByRole("tab", { name: "思维导图", exact: true }).click();
    await page
      .getByRole("button", { name: "重新生成", exact: true })
      .first()
      .click();
    await page.evaluate(() => {
      window.__TEST_BACKEND__.notes[0].summary = "## 新总结\n新生成的总结。";
      window.__TEST_BACKEND__.notes[0].preview = "新预览";
      window.__HOLD_NEXT_READ__ = true;
      window.__TEST_BACKEND__.tasks.find(
        (task) => task.task_id === "start_summarize",
      ).status = "completed";
    });
    await page.waitForFunction(() => window.__READ_HELD__);
    await page.evaluate(() => {
      window.__TEST_BACKEND__.notes[0].mindmap =
        "mindmap\n  root((最新导图))\n    新增节点";
      window.__TEST_BACKEND__.tasks.find(
        (task) => task.task_id === "start_mindmap",
      ).status = "completed";
    });
    await page.getByText("最新导图", { exact: true }).waitFor();
    await page.evaluate(() => window.__RELEASE_READ__());
    await page.getByRole("tab", { name: "AI 总结", exact: true }).click();
    await page.getByText("总结已更新", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "新总结", exact: true }).waitFor();
    await page.getByRole("tab", { name: "思维导图", exact: true }).click();
    await page.locator(".mermaid-container svg").waitFor();
    assert.equal(
      await page.getByText("最新导图", { exact: true }).count(),
      1,
      "总结的迟到快照不能回滚已完成的导图",
    );
    results.push("并发总结与导图乱序读取时，各自产物独立更新");
    for (const kind of ["summarize", "transcribe"]) {
      await page.evaluate((kind) => {
        const tasks = window.__TEST_BACKEND__.tasks;
        tasks.splice(
          0,
          tasks.length,
          ...tasks.filter(
            (task) => !["start_summarize", "task-new"].includes(task.task_id),
          ),
        );
        tasks.push({
          task_id: `failed-leave-${kind}`,
          kind,
          note_id: kind === "summarize" ? "one" : null,
          bvid: kind === "transcribe" ? "BV-new" : null,
          source_url: "https://www.bilibili.com/video/BV-new",
          status: "failed",
          progress: "失败",
          error: `离页重试 ${kind}`,
        });
        window.__PAUSE_START__ =
          kind === "summarize" ? "start_summarize" : "start_transcribe";
        window.__RETRY_STARTED__ = false;
      }, kind);
      await reopenLibrary();
      await page
        .locator(".task-item")
        .filter({ hasText: `离页重试 ${kind}` })
        .getByRole("button", { name: "重试任务", exact: true })
        .click();
      await page.waitForFunction(() => window.__RETRY_STARTED__);
      await page.evaluate(() => {
        location.hash = "#/settings";
      });
      await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
      await page.evaluate(() => window.__RELEASE_RETRY__());
      await page.waitForFunction(
        (kind) =>
          window.__TEST_CALLS__.some(
            (call) =>
              call.cmd === "dismiss_task" &&
              call.args.taskId === `failed-leave-${kind}`,
          ),
        kind,
      );
      await page.evaluate(() => {
        window.__PAUSE_START__ = null;
      });
      await reopenLibrary();
      assert.equal(
        await page.getByText(`离页重试 ${kind}`, { exact: true }).count(),
        0,
      );
    }
    results.push("重试入队时切页，迟到成功返回仍清理旧失败记录");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, "task-consistency-results.json"),
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
