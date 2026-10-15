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
      viewport: { width: 1280, height: 900 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page);
    await page.goto(base);
    await page.locator("[data-note-row]").first().waitFor();
    await page.evaluate(() => {
      window.__INTERACTION__ = { delays: {}, errors: {}, calls: [] };
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        const state = window.__INTERACTION__;
        state.calls.push({ cmd, args: structuredClone(args) });
        if (state.delays[cmd])
          await new Promise((resolve) =>
            setTimeout(resolve, state.delays[cmd]),
          );
        if (state.errors[cmd]) throw state.errors[cmd];
        if (state.overrides?.[cmd])
          return structuredClone(state.overrides[cmd]);
        return invoke(cmd, args);
      };
    });
    const navigate = async (route) =>
      page.evaluate((value) => {
        location.hash = "#" + value;
      }, route);
    const control = async (delays = {}, failures = {}) =>
      page.evaluate(
        ({ delays, failures }) => {
          window.__INTERACTION__.delays = delays;
          window.__INTERACTION__.errors = failures;
          window.__INTERACTION__.calls = [];
        },
        { delays, failures },
      );

    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await control({ get_notes: 1200 });
    await navigate("/");
    await page.waitForTimeout(150);
    assert.equal(
      await page.getByRole("status", { name: "正在加载笔记库" }).count(),
      1,
    );
    assert.equal(
      await page.getByRole("heading", { name: "从第一条视频开始" }).count(),
      0,
    );
    await page.screenshot({
      path: path.join(output, "interaction-library-loading.png"),
    });
    await page.locator("[data-note-row]").first().waitFor();
    results.push("慢速读取显示骨架，不闪现空库");

    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await control({}, { get_notes: "暂时无法读取笔记" });
    await navigate("/");
    await page
      .getByRole("heading", { name: "笔记库暂时无法加载", exact: true })
      .waitFor();
    await control();
    await page
      .getByRole("button", { name: "重新加载笔记", exact: true })
      .click();
    await page.locator("[data-note-row]").first().waitFor();
    results.push("读取失败就地重试并恢复内容");

    await control({}, { get_config: "暂时无法读取设置" });
    await navigate("/settings");
    await page
      .getByRole("heading", { name: "设置暂时无法读取", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "保存设置", exact: true })
        .isDisabled(),
      true,
    );
    await control();
    await page
      .getByRole("button", { name: "重新读取设置", exact: true })
      .click();
    await page.getByLabel("模型名称", { exact: true }).waitFor();
    await navigate("/");
    await page.locator("[data-note-row]").first().waitFor();
    results.push("设置读取失败禁止保存默认值，重试后恢复原配置");

    await control({ get_config: 1200 });
    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "保存设置", exact: true })
        .isDisabled(),
      true,
    );
    await page.screenshot({
      path: path.join(output, "interaction-settings-loading.png"),
    });
    await page.getByLabel("模型名称", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "保存设置", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="保存设置"]').disabled,
    );
    await control({ save_config: 900 });
    await page.getByRole("button", { name: "3 个任务", exact: true }).click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "保存设置", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "4 个任务", exact: true }).click();
    await page.getByText("还有未保存的修改", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__INTERACTION__.calls.filter((c) => c.cmd === "save_config")
            .length,
      ),
      1,
    );
    const saved = await page.evaluate(
      () =>
        window.__TEST_CALLS__.filter((c) => c.cmd === "save_config").at(-1).args
          .config,
    );
    assert.equal(saved.max_concurrent_transcribe, 3);
    results.push("配置加载前禁止保存，保存有等待状态，新编辑不会被误报已保存");

    await control();
    await page
      .getByLabel("模型名称", { exact: true })
      .fill("unsaved-interaction-model");
    await page.evaluate(() => {
      const previous = window.__TEST_CALLS__
        .filter((c) => c.cmd === "save_config")
        .at(-1).args.config;
      window.__INTERACTION__.overrides = {
        get_config: {
          ...previous,
          bilibili_sessdata: "fixture-refreshed-session",
        },
        get_login_status: { is_login: true, uname: "离线验收账号" },
      };
      window.__TEST_BACKEND__.qrStatus = "success";
    });
    await page.getByRole("button", { name: "扫码登录", exact: true }).click();
    await page.getByText("登录成功！", { exact: true }).waitFor();
    await page
      .getByRole("dialog", { name: "扫码登录", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByLabel("模型名称", { exact: true }).inputValue(),
      "unsaved-interaction-model",
    );
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__INTERACTION__.calls
          .filter((c) => c.cmd === "save_config")
          .at(-1)?.args.config.bilibili_sessdata ===
        "fixture-refreshed-session",
      null,
      { timeout: 2000 },
    );
    await page.evaluate(() => {
      window.__INTERACTION__.overrides = {};
    });
    results.push(
      "登录刷新只合并账户字段，保留未保存编辑，后续保存不会写回旧会话",
    );

    await control(
      { parse_link: 700 },
      { parse_link: "链接解析失败，请检查输入" },
    );
    await navigate("/");
    const input = page.getByLabel("B站视频链接", { exact: true });
    await input.fill("bad-link-for-retry");
    await page.getByRole("button", { name: "开始转录", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "正在提交…", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await input.inputValue(), "bad-link-for-retry");
    await page
      .getByRole("dialog", { name: "操作未完成", exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(output, "interaction-error.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "bad-link-for-retry");
    results.push("提交即时反馈且失败保留输入");

    await control(
      { cancel_task: 600 },
      { cancel_task: "暂时无法取消，请重试" },
    );
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page
      .getByRole("button", { name: /^取消任务/ })
      .first()
      .click();
    assert.equal(
      await page.getByRole("button", { name: /^正在取消/ }).isDisabled(),
      true,
    );
    await page
      .getByRole("dialog", { name: "操作未完成", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "操作未完成", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByRole("button", { name: /^取消任务/ }).isEnabled(),
      true,
    );
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    results.push("取消等待期间防重复，失败恢复可操作并说明原因");

    await control();
    await page.evaluate(() =>
      window.__TEST_BACKEND__.tasks.push(
        {
          task_id: "summary-extra",
          kind: "summarize",
          note_id: "one",
          bvid: null,
          status: "running",
          progress: "正在生成总结",
          created_at: Date.now() / 1000,
        },
        {
          task_id: "mindmap-extra",
          kind: "mindmap",
          note_id: "two",
          bvid: null,
          status: "queued",
          progress: "等待生成导图",
          created_at: Date.now() / 1000,
        },
      ),
    );
    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await navigate("/");
    await page.getByText("3 个任务正在处理", { exact: true }).waitFor();
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page.getByText("生成总结", { exact: true }).waitFor();
    await page.getByText("生成导图", { exact: true }).waitFor();
    await page
      .getByRole("heading", {
        name: "Transformer 从零理解注意力机制",
        exact: true,
      })
      .last()
      .waitFor();
    await page.waitForTimeout(260);
    await page.screenshot({
      path: path.join(output, "interaction-inline-tasks.png"),
    });
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    results.push("库内任务区恢复三种后台任务并显示实际笔记标题");

    await page.evaluate(() =>
      window.__TEST_BACKEND__.tasks.push({
        task_id: "failed-summary",
        kind: "summarize",
        note_id: "two",
        bvid: null,
        status: "failed",
        progress: "生成失败",
        error: "临时连接中断",
        created_at: Date.now() / 1000,
      }),
    );
    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await navigate("/");
    await page.getByRole("button", { name: "查看任务", exact: true }).click();
    await page
      .getByRole("button", { name: "重试任务", exact: true })
      .waitFor({ timeout: 1500 });
    await control({ start_summarize: 700 });
    await page.getByRole("button", { name: "重试任务", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "正在重试…", exact: true })
        .isDisabled(),
      true,
    );
    await page.waitForFunction(() =>
      window.__TEST_BACKEND__.tasks.some(
        (t) => t.task_id === "start_summarize",
      ),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__INTERACTION__.calls.filter(
            (c) => c.cmd === "start_summarize",
          ).length,
      ),
      1,
    );
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    results.push("失败生成可在库内重试，重复点击不会新增请求");

    await control({ get_note: 900 });
    await navigate("/note/one");
    await page.waitForTimeout(150);
    assert.equal(
      await page
        .getByRole("status", { name: "正在加载笔记", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("heading", {
        name: "Transformer 从零理解注意力机制",
        exact: true,
      })
      .waitFor();
    await control({}, { get_note: "暂时无法读取这篇笔记" });
    await navigate("/note/two");
    await page
      .getByRole("heading", { name: "笔记暂时无法读取", exact: true })
      .waitFor();
    await control();
    await page
      .getByRole("button", { name: "重新加载笔记", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "如何建立持续有效的阅读习惯", exact: true })
      .waitFor();
    results.push("笔记慢读取显示内容骨架，失败后原位重试");

    await navigate("/note/one");
    await page.getByRole("button", { name: "复制总结", exact: true }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("copy denied");
          },
        },
      });
      document.execCommand = () => false;
    });
    await page.getByRole("button", { name: "复制总结", exact: true }).click();
    await page.getByText("复制失败，请重试", { exact: true }).first().waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("tab", { name: "原始转录", exact: true }).click();
    assert.equal(
      await page.getByRole("tabpanel").getAttribute("aria-labelledby"),
      "tab-transcript",
    );
    const duration = await page
      .getByRole("tabpanel")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    assert.ok(duration.split(",").every((s) => parseFloat(s) <= 0.001));
    await page.evaluate(() => {
      HTMLElement.prototype.scrollIntoView = function (options) {
        window.__TEST_SCROLL__ = options;
      };
    });
    await page.getByRole("tab", { name: "AI 总结", exact: true }).click();
    await page
      .getByRole("navigation", { name: "本页目录", exact: true })
      .getByRole("button", { name: "核心概念", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.__TEST_SCROLL__.behavior),
      "auto",
    );
    results.push("复制失败可见，减少动效下标签切换仍可用");

    await page.evaluate(() => {
      window.__TEST_BACKEND__.notes[0].mindmap = "invalid diagram";
      window.__TEST_BACKEND__.tasks.forEach((task) => {
        task.status = "cancelled";
      });
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await navigate("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await navigate("/note/one");
    await page.getByRole("tab", { name: "思维导图", exact: true }).click();
    await page.getByText("思维导图渲染失败", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "重新生成", exact: true })
      .last()
      .click();
    await page.waitForFunction(() =>
      window.__TEST_BACKEND__.tasks.some(
        (task) => task.task_id === "start_mindmap",
      ),
    );
    await page.evaluate(() => {
      window.__TEST_BACKEND__.notes[0].mindmap =
        "mindmap\n  root((恢复后的导图))\n    可正常查看";
      window.__TEST_BACKEND__.tasks.find(
        (task) => task.task_id === "start_mindmap",
      ).status = "completed";
    });
    await page.locator(".mermaid-container svg").waitFor();
    assert.equal(
      await page.getByText("思维导图渲染失败", { exact: true }).count(),
      0,
    );
    results.push("导图绘制失败后重新生成可恢复真实SVG");

    assert.deepEqual(errors, []);
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, "interaction-results.json"),
      JSON.stringify(
        { status: "passed", results, runtimeErrors: errors },
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
