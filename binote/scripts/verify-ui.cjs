// 只在浏览器注入离线 Tauri 桥接；正式应用不包含样例数据或演示逻辑。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const output = process.env.BINOTE_QA_DIR
  ? path.resolve(process.env.BINOTE_QA_DIR)
  : path.resolve(__dirname, "../test-results/ui");
const base = process.env.BINOTE_TEST_URL || "http://127.0.0.1:5173";
const onlyLibrary = process.argv[2] === "library";

async function fixture(page, { mobile = false } = {}) {
  await page.addInitScript(
    ({ mobile }) => {
      const notes = [
        {
          id: "one",
          bvid: "BV1demo",
          source_url: null,
          title: "Transformer 从零理解注意力机制",
          cover: "",
          transcript:
            "## P1 开场\n[00:00] 查询、键和值通过加权计算形成上下文。\n\n位置编码用于表达序列顺序。",
          summary:
            "## 核心概念\n注意力通过 **Q、K、V** 的加权计算关联上下文。\n\n## 位置编码\n保留顺序信息。",
          preview:
            "通过 Q、K、V 的加权计算理解注意力，并串起 Transformer 的主要组件。",
          mindmap: "mindmap\n  root((注意力机制))\n    查询\n    键\n    值",
          created_at: 1791950400,
          transcript_source: "subtitle",
          transcript_reason: null,
        },
        {
          id: "two",
          bvid: "BV2demo",
          source_url: null,
          title: "如何建立持续有效的阅读习惯",
          cover: "",
          transcript: "[00:12] 每天固定时间阅读，并记录自己的问题。",
          summary: null,
          preview: null,
          mindmap: null,
          created_at: 1791864000,
          transcript_source: "asr",
          transcript_reason: "没有可用字幕",
        },
      ];
      let config = {
        asr_provider: "sensevoice",
        asr_api_key: null,
        sensevoice_api_key: "fixture-key",
        llm_api_key: "fixture-key",
        llm_base_url: "https://example.invalid/v1",
        llm_model: "fixture-model",
        llm_provider: "api",
        codex_model: "user-model",
        codex_path: null,
        codex_fast: false,
        auto_summary: true,
        auto_mindmap: true,
        max_concurrent_transcribe: 2,
        bilibili_sessdata: null,
        bilibili_bili_jct: null,
        bilibili_refresh_token: null,
        bilibili_dede_user_id: null,
        bilibili_cookie_ts: null,
      };
      const tasks = [
        {
          task_id: "task-existing",
          status: "running",
          progress: "正在转录 P2 / 3",
          note_id: null,
          error: null,
          kind: "transcribe",
          bvid: "BV3demo",
          source_url: null,
          created_at: 1791950400,
        },
      ];
      const calls = [];
      window.__TEST_CALLS__ = calls;
      const callbacks = new Map();
      const listeners = new Map();
      window.__TEST_BACKEND__ = {
        notes,
        tasks,
        failures: {},
        delays: {},
        qrStatus: "waiting",
      };
      window.__TEST_EMIT__ = (event, payload) => {
        for (const [id, listener] of listeners) {
          if (listener.event === event)
            callbacks.get(listener.handler)?.({ event, id, payload });
        }
      };
      let next = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback(callback, once) {
          const id = ++next;
          callbacks.set(id, (result) => {
            if (once) callbacks.delete(id);
            callback(result);
          });
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        async invoke(cmd, args = {}) {
          calls.push({ cmd, args });
          if (window.__TEST_BACKEND__.failures[cmd])
            throw window.__TEST_BACKEND__.failures[cmd];
          if (cmd === "plugin:event|listen") {
            const id = ++next;
            listeners.set(id, args);
            return id;
          }
          if (cmd === "plugin:event|unlisten") {
            listeners.delete(args.eventId);
            return null;
          }
          if (cmd === "consume_notification_nav_target") return null;
          if (cmd === "get_notes") return structuredClone(notes);
          if (cmd === "get_note") {
            const note = structuredClone(
              notes.find((n) => n.id === args.id) || null,
            );
            const delay = window.__TEST_BACKEND__.delays[args.id] || 0;
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            return note;
          }
          if (cmd === "get_config") return structuredClone(config);
          if (cmd === "save_config") {
            config = structuredClone(args.config);
            return null;
          }
          if (cmd === "supports_codex") return !mobile;
          if (cmd === "get_login_status")
            return { is_login: false, uname: null };
          if (cmd === "list_tasks") return structuredClone(tasks);
          if (cmd === "dismiss_task") {
            const index = tasks.findIndex(
              (task) => task.task_id === args.taskId,
            );
            if (index >= 0) {
              if (
                !["completed", "failed", "cancelled"].includes(
                  tasks[index].status,
                )
              )
                throw "任务仍在处理中";
              tasks.splice(index, 1);
            }
            return null;
          }
          if (cmd === "get_task_status")
            return structuredClone(
              tasks.find((t) => t.task_id === args.taskId),
            );
          if (cmd === "get_video_info")
            return {
              bvid: args.bvid,
              title: "正在整理的长视频",
              cover: "",
              duration: 100,
              cid: 1,
              aid: 1,
            };
          if (cmd === "cancel_task") {
            const task = tasks.find((t) => t.task_id === args.taskId);
            if (task) task.status = "cancelled";
            return null;
          }
          if (cmd === "parse_link") {
            if (args.input === "bad") throw "无法解析视频链接";
            return "BV-new";
          }
          if (cmd === "start_transcribe") {
            tasks.push({
              task_id: "task-new",
              status: "running",
              kind: "transcribe",
              bvid: args.bvid,
              source_url: args.sourceUrl,
              note_id: null,
              error: null,
              progress: "正在准备",
              created_at: 1791950410,
            });
            return "task-new";
          }
          if (cmd === "delete_note") {
            const i = notes.findIndex((n) => n.id === args.id);
            if (i >= 0) notes.splice(i, 1);
            return null;
          }
          if (cmd === "start_summarize" || cmd === "start_mindmap") {
            tasks.push({
              task_id: cmd,
              kind: cmd === "start_summarize" ? "summarize" : "mindmap",
              status: "running",
              note_id: args.noteId,
              progress: "正在生成",
              error: null,
              created_at: 1791950420,
            });
            return cmd;
          }
          if (cmd === "qrcode_generate") {
            const delay = window.__TEST_BACKEND__.delays.qr || 0;
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            return {
              url: "https://example.invalid/login",
              qrcode_key: "fixture-qr",
            };
          }
          if (cmd === "qrcode_poll")
            return {
              status: window.__TEST_BACKEND__.qrStatus,
              message: "等待扫码",
              credentials: null,
            };
          if (
            [
              "test_llm_connection",
              "test_asr_connection",
              "test_codex_connection",
            ].includes(cmd)
          )
            return {
              ok: true,
              severity: "ok",
              message: "离线连接样例通过",
              latency_ms: 1,
            };
          throw new Error("未模拟的命令：" + cmd);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    },
    { mobile },
  );
}

async function run() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch(launchOptions);
  const results = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1506, height: 1045 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page);
    await page.goto(base);
    await page.getByRole("heading", { name: "笔记库", exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "搜索笔记" }).fill("固定时间");
    await page
      .getByRole("heading", { name: "如何建立持续有效的阅读习惯", exact: true })
      .waitFor();
    assert.equal(await page.locator("[data-note-row]").count(), 1);
    await page.getByRole("searchbox", { name: "搜索笔记" }).fill("");
    assert.equal(await page.locator("[data-note-row]").count(), 2);
    assert.match(
      await page.locator("[data-note-row]").first().innerText(),
      /通过 Q、K、V/,
    );
    assert.equal(await page.locator("[data-note-row] img").count(), 0);
    await page.screenshot({ path: path.join(output, "library-desktop.png") });
    results.push("搜索标题/转录、真实预览、无封面");
    await page.getByRole("button", { name: "查看任务" }).click();
    await page
      .getByRole("region", { name: "后台任务", exact: true })
      .getByRole("heading", { name: "正在整理的长视频", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "取消任务 正在整理的长视频" })
      .click();
    await page.waitForFunction(() =>
      window.__TEST_CALLS__.some((c) => c.cmd === "cancel_task"),
    );
    await page.getByRole("button", { name: "收起任务", exact: true }).click();
    results.push("任务恢复、原位展开、取消");
    if (!onlyLibrary) {
      await page
        .getByRole("heading", {
          name: "Transformer 从零理解注意力机制",
          exact: true,
        })
        .click();
      await page.getByRole("tab", { name: "AI 总结", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page
          .getByRole("tab", { name: "原始转录", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.getByRole("tab", { name: "原始转录", exact: true }).click();
      await page
        .getByText("查询、键和值通过加权计算形成上下文。", { exact: false })
        .waitFor();
      await page.screenshot({
        path: path.join(output, "transcript-desktop.png"),
      });
      await page.getByRole("tab", { name: "思维导图", exact: true }).click();
      await page.locator(".mermaid-container svg").waitFor();
      await page.screenshot({ path: path.join(output, "mindmap-desktop.png") });
      await page
        .getByRole("button", { name: "放大思维导图", exact: true })
        .click();
      await page.getByText("120%", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "重置思维导图缩放", exact: true })
        .click();
      await page.getByText("100%", { exact: true }).waitFor();
      await page.getByRole("tab", { name: "AI 总结", exact: true }).click();
      await page.getByRole("navigation", { name: "本页目录" }).waitFor();
      await page.screenshot({ path: path.join(output, "summary-desktop.png") });
      results.push("三种阅读视图、目录、真实 Mermaid");
      await page.goto(base + "/#/settings");
      await page
        .getByRole("heading", { name: "视频转录", exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "AI 笔记生成", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Codex 订阅", exact: true })
        .click();
      await page
        .getByLabel("模型名称", { exact: true })
        .fill("my-selected-model");
      await page.getByRole("radio", { name: "Fast", exact: true }).check();
      await page.getByRole("switch", { name: "自动生成总结" }).click();
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      const saved = await page.evaluate(
        () =>
          window.__TEST_CALLS__.filter((c) => c.cmd === "save_config").at(-1)
            .args.config,
      );
      assert.equal(saved.codex_model, "my-selected-model");
      assert.equal(saved.auto_summary, false);
      assert.equal(saved.codex_fast, true);
      assert.equal(saved.llm_api_key, "fixture-key");
      await page.screenshot({
        path: path.join(output, "settings-desktop.png"),
      });
      results.push("两栏设置、Codex 手填、自动产物、完整配置保存");
      await page.getByRole("button", { name: "扫码登录", exact: true }).click();
      await page
        .getByRole("dialog", { name: "扫码登录", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      results.push("二维码登录入口");
      const phone = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      await fixture(phone, { mobile: true });
      for (const [route, name] of [
        ["/", "library"],
        ["/note/one", "summary"],
        ["/settings", "settings"],
      ]) {
        await phone.goto(base + "/#" + route);
        await phone.locator("main").waitFor();
        await phone.waitForTimeout(350);
        assert(
          await phone.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "手机不应横向溢出 " + route,
        );
        await phone.screenshot({
          path: path.join(output, name + "-mobile.png"),
        });
      }
      assert.equal(
        await phone
          .getByRole("button", { name: "Codex 订阅", exact: true })
          .count(),
        0,
      );
      results.push("手机布局、安全区、Android 隐藏 Codex");
      await phone.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "browser-results.json"),
      JSON.stringify({ status: "passed", results, errors }, null, 2),
    );
    console.log(JSON.stringify({ status: "passed", results }));
  } catch (e) {
    await fs.writeFile(
      path.join(output, "browser-failure.txt"),
      e.stack || String(e),
    );
    throw e;
  } finally {
    await browser.close();
  }
}
module.exports = { fixture, base, output };
if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
