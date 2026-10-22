// Production React UI, offline Tauri fixture only; never accesses application data or real models.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const { fixture, base, output } = require("./verify-ui.cjs");

const library = [
  { id: "course", name: "课程笔记", content: "## 核心概念\n按概念、例子、易错点整理。" },
  { id: "quick", name: "三分钟速读", content: "用三个要点和一句结论总结。" },
  { id: "coding", name: "编程教程", content: "记录问题、实现步骤和注意事项。" },
];
const initialConfig = { summary_templates: library, default_summary_template_id: "course" };
const literal = '  ## 自定义结构\n保留 {title}、{transcript} 和 {"literal": true}。\n\n最后列出可执行的行动。  ';

// Capture resting states, not a partially transparent entrance frame.
async function capture(page, options) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map((animation) => animation.finished.catch(() => {})));
  });
  await page.screenshot(options);
}

async function run() {
  const browser = await chromium.launch(launchOptions);
  const results = [], errors = [];
  const pages = [];
  const open = async (options = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options.device });
    pages.push(page);
    page.setDefaultTimeout(7000);
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page, options);
    await page.goto(base + "/#/settings");
    return page;
  };
  const button = (p, name) => p.getByRole("button", { name, exact: true });
  const defaults = (p) => p.getByLabel("默认总结模板", { exact: true });
  const name = (p) => p.getByLabel("模板名称", { exact: true });
  const content = (p) => p.getByLabel("总结要求", { exact: true });
  const edit = async (p, id) => p.locator(`button[data-template-id="${id}"]`).click();
  const manage = async (p) => {
    await button(p, "管理模板").click();
    await p.getByRole("heading", { name: "总结模板", exact: true }).waitFor();
    assert.equal(new URL(p.url()).hash, "#/settings", "management stays in the Settings route");
  };
  const saves = (p) => p.evaluate(() => window.__TEST_CALLS__.filter((c) => c.cmd === "save_config"));
  const save = async (p) => {
    await button(p, "保存设置").click();
    await p.waitForFunction(() => !document.querySelector('[aria-label="保存设置"]').disabled);
  };
  const noOverflow = async (p) => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
  try {
    await fs.mkdir(output, { recursive: true });
    const p = await open({ initialConfig, persistConfigKey: "binote-template-regression" });
    await p.getByLabel("模型名称", { exact: true }).waitFor();
    assert.equal(await button(p, "管理模板").count(), 1, "正式设置缺少模板管理入口");
    assert.equal(await defaults(p).inputValue(), "course");
    await capture(p, { path: path.join(output, "templates-entry-desktop.png"), fullPage: true });
    await manage(p);
    assert.equal(await defaults(p).inputValue(), "course");
    await edit(p, "quick");
    await name(p).fill("三分钟速读 · 修改");
    await content(p).fill(literal);
    assert.equal(await defaults(p).inputValue(), "course", "editing cannot change the default");
    await edit(p, "course");
    await edit(p, "quick");
    assert.equal(await content(p).inputValue(), literal);
    await button(p, "返回设置").click();
    await p.getByRole("heading", { name: "AI 笔记生成", exact: true }).waitFor();
    await manage(p);
    assert.equal(await content(p).inputValue(), literal, "returning retains draft and editor selection");
    assert.equal((await saves(p)).length, 0, "navigation and editing must not save implicitly");
    results.push("编辑与全局默认分离，切换模板/返回设置保留草稿与编辑选择");

    await edit(p, "");
    assert.equal(await name(p).isEditable(), false);
    assert.equal(await content(p).isEditable(), false);
    assert.equal(await button(p, "删除模板").count(), 0);
    const builtin = await content(p).inputValue();
    assert.equal(builtin, await p.evaluate(() => window.__TEST_BACKEND__.templateDefaults.content));
    await capture(p, { path: path.join(output, "templates-builtin-desktop.png"), fullPage: true });
    await button(p, "创建副本").click();
    assert.equal(await name(p).evaluate((el) => document.activeElement === el), true);
    assert.equal(await content(p).inputValue(), builtin);
    assert.equal(await defaults(p).inputValue(), "course");
    await name(p).fill("自定义课程");
    await content(p).fill(literal);
    await button(p, "新建模板").click();
    assert.equal(await name(p).evaluate((el) => document.activeElement === el), true);
    assert.equal(await content(p).inputValue(), builtin);
    await capture(p, { path: path.join(output, "templates-new-desktop.png"), fullPage: true });
    await name(p).fill("代码复盘");
    await content(p).fill("## 代码复盘\n对比实现思路。");
    assert.equal(await defaults(p).inputValue(), "course");
    results.push("内置内容来自元数据且不可改删；复制/新建聚焦名称，不隐式切换默认");

    // All validators block invokes, not merely display a warning. Count Unicode scalars.
    const beforeValidation = (await saves(p)).length;
    for (const invalid of ["", "\u0085", "课程笔记", " 课程笔记 ", "😀".repeat(81)]) {
      await name(p).fill(invalid);
      assert.equal(await name(p).getAttribute("aria-invalid"), "true");
      assert.equal(await button(p, "保存设置").isDisabled(), true);
    }
    await name(p).fill("😀".repeat(80));
    assert.equal(await button(p, "保存设置").isEnabled(), true, "80 scalars, not 160 UTF-16 units");
    await name(p).fill("代码复盘");
    for (const invalid of ["", " \n\t", "😀".repeat(12001)]) {
      await content(p).fill(invalid);
      assert.equal(await content(p).getAttribute("aria-invalid"), "true");
      assert.equal(await button(p, "保存设置").isDisabled(), true);
    }
    await content(p).fill("😀".repeat(12000));
    assert.equal(await button(p, "保存设置").isEnabled(), true);
    await content(p).fill(literal);
    assert.equal((await saves(p)).length, beforeValidation);
    await defaults(p).selectOption("quick");
    await save(p);
    await p.getByRole("status").getByText("设置已保存。", { exact: true }).waitFor();
    let saved = (await saves(p)).at(-1).args.config;
    assert.equal(saved.summary_templates.length, 5);
    assert.equal(saved.default_summary_template_id, "quick");
    assert.equal(saved.summary_templates.find((t) => t.name === "代码复盘").content, literal);
    assert.equal(saved.llm_api_key, "fixture-key");
    assert.equal(saved.auto_summary, true);
    assert.equal(saved.auto_mindmap, true);
    assert(saved.summary_templates.every((t) => /^[A-Za-z0-9_-]{1,64}$/.test(t.id)));
    assert.equal(new Set(saved.summary_templates.map((t) => t.id)).size, 5);
    await p.reload();
    await defaults(p).waitFor();
    assert.equal(await defaults(p).inputValue(), "quick");
    await manage(p);
    await edit(p, saved.summary_templates.find((t) => t.name === "代码复盘").id);
    assert.equal(await content(p).inputValue(), literal);
    results.push("空白/重名/长度校验、Unicode 边界、字面正文、完整保存与刷新读回");

    await edit(p, "quick");
    await button(p, "删除模板").click();
    const dialog = p.getByRole("dialog", { name: "删除总结模板", exact: true });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /默认.*标准笔记/);
    assert.equal(await button(p, "取消").evaluate((el) => document.activeElement === el), true);
    await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await name(p).inputValue(), "三分钟速读 · 修改");
    assert.equal(await defaults(p).inputValue(), "quick");
    assert.equal(await button(p, "删除模板").evaluate((el) => document.activeElement === el), true);
    await button(p, "删除模板").click();
    await button(p, "确认删除").click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await defaults(p).inputValue(), "");
    assert.equal(await p.locator('button[data-template-id="quick"]').count(), 0);
    assert.equal((await saves(p)).length, 0, "deletion remains a draft after reload");
    await save(p);
    saved = (await saves(p)).at(-1).args.config;
    assert.equal(saved.default_summary_template_id, null);
    assert.equal(saved.summary_templates.some((t) => t.id === "quick"), false);
    assert.equal(await p.evaluate(() => window.__TEST_BACKEND__.notes[0].summary), "## 核心概念\n注意力通过 **Q、K、V** 的加权计算关联上下文。\n\n## 位置编码\n保留顺序信息。");
    results.push("删除确认默认聚焦取消、Escape 恢复焦点；删除默认与回退同次保存，不触碰笔记");

    await edit(p, "course");
    await name(p).fill("保存失败仍保留");
    await p.evaluate(() => { window.__TEST_BACKEND__.failures.save_config = "离线模拟保存失败"; });
    await button(p, "保存设置").click();
    await p.getByText("设置未保存，请重试。你的修改仍然保留。", { exact: true }).waitFor();
    assert.equal(await name(p).inputValue(), "保存失败仍保留");
    assert.equal(await defaults(p).inputValue(), "");
    await capture(p, { path: path.join(output, "templates-save-error-desktop.png"), fullPage: true });
    await p.evaluate(() => { delete window.__TEST_BACKEND__.failures.save_config; });
    await save(p);
    assert.equal(await p.getByText("设置未保存，请重试。你的修改仍然保留。", { exact: true }).count(), 0);
    results.push("保存失败原位显示，草稿/位置保留，重试成功清除失败状态");

    await name(p).fill("保存快照");
    await p.evaluate(() => { window.__TEST_BACKEND__.gates.save_config = true; });
    const beforeGate = (await saves(p)).length;
    await button(p, "保存设置").click();
    await p.waitForFunction(() => !!window.__TEST_BACKEND__.releases.save_config);
    assert.equal(await button(p, "保存设置").isDisabled(), true);
    await name(p).fill("保存期间继续编辑");
    await p.evaluate(() => {
      window.__TEST_BACKEND__.gates.save_config = false;
      window.__TEST_BACKEND__.releases.save_config();
    });
    await p.waitForFunction(() => !document.querySelector('[aria-label="保存设置"]').disabled);
    assert.equal((await saves(p)).length, beforeGate + 1);
    assert.equal((await saves(p)).at(-1).args.config.summary_templates.find((t) => t.id === "course").name, "保存快照");
    assert.equal(await name(p).inputValue(), "保存期间继续编辑");
    await p.getByText("还有未保存的修改", { exact: true }).waitFor();
    assert.equal(await button(p, "保存设置").innerText(), "保存设置");
    results.push("保存同步防重复、深层模板采用不可变更新，晚到成功不覆盖后续编辑");

    // The real QR polling/refresh path, with a fictional success response only.
    await button(p, "返回设置").click();
    await p.evaluate(() => {
      window.__TEST_BACKEND__.config = {
        ...window.__TEST_BACKEND__.config,
        bilibili_sessdata: "refreshed-template-fixture-session",
        summary_templates: [],
        default_summary_template_id: null,
      };
      window.__TEST_BACKEND__.qrStatus = "success";
    });
    await button(p, "扫码登录").click();
    await p.getByText("登录成功！", { exact: true }).waitFor();
    await p.getByRole("dialog", { name: "扫码登录", exact: true }).waitFor({ state: "hidden" });
    await manage(p);
    assert.equal(await name(p).inputValue(), "保存期间继续编辑");
    await save(p);
    saved = (await saves(p)).at(-1).args.config;
    assert.equal(saved.bilibili_sessdata, "refreshed-template-fixture-session");
    assert.equal(saved.summary_templates.find((t) => t.id === "course").name, "保存期间继续编辑");
    await capture(p, { path: path.join(output, "templates-editing-desktop.png"), fullPage: true });
    results.push("扫码后的账号刷新合并新凭证，同时保留全部模板草稿");

    const empty = await open();
    await defaults(empty).waitFor();
    assert.equal(await defaults(empty).inputValue(), "");
    assert.equal((await saves(empty)).length, 0);
    await manage(empty);
    assert.equal(await empty.locator("button[data-template-id]").count(), 1);
    assert.equal(await content(empty).isEditable(), false);
    results.push("空模板库仍可查看/复制内置模板，不在加载时写入配置");

    const broken = await open({ failures: { get_summary_template_defaults: "metadata unavailable" } });
    await broken.getByRole("heading", { name: "设置暂时无法读取", exact: true }).waitFor();
    assert.equal(await button(broken, "保存设置").isDisabled(), true);
    await broken.evaluate(() => { delete window.__TEST_BACKEND__.failures.get_summary_template_defaults; });
    await button(broken, "重新读取设置").click();
    await defaults(broken).waitFor();
    assert.equal(await button(broken, "保存设置").isEnabled(), true);
    results.push("元数据读取失败不伪造默认正文、不允许保存；重新读取可恢复");

    // A dangling/empty selected ID is not silently mapped to the built-in selection.
    for (const missing of ["missing-private-template", ""]) {
      const invalid = await open({ initialConfig: { summary_templates: [], default_summary_template_id: missing } });
      await defaults(invalid).waitFor();
      assert.equal(await button(invalid, "保存设置").isDisabled(), true);
      await defaults(invalid).selectOption("");
      await save(invalid);
      assert.equal((await saves(invalid)).at(-1).args.config.default_summary_template_id, null);
      await invalid.close();
    }
    results.push("失效及空字符串默认 ID 明确阻止保存，可主动恢复内置，不自动修复");

    const many = await open({ initialConfig: {
      summary_templates: Array.from({ length: 50 }, (_, i) => ({ id: `t-${i}`, name: `课程笔记 ${i + 1}`, content: "记录概念与练习。" })),
      default_summary_template_id: "t-0",
    } });
    await defaults(many).waitFor();
    await manage(many);
    assert.equal(await button(many, "新建模板").isDisabled(), true);
    await edit(many, "");
    assert.equal(await button(many, "创建副本").isDisabled(), true);
    const bounds = await many.locator('[aria-label="模板列表"]').evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    assert(bounds.height <= 480 && bounds.scroll > bounds.height, JSON.stringify(bounds));
    await noOverflow(many);
    results.push("50 个自定义模板上限，桌面库独立滚动且无法继续新建/复制");

    const phone = await open({ initialConfig, mobile: true, device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    await defaults(phone).waitFor();
    await capture(phone, { path: path.join(output, "templates-entry-mobile.png"), fullPage: true });
    await manage(phone);
    const editing = phone.getByLabel("正在编辑", { exact: true });
    await editing.selectOption("coding");
    await name(phone).fill("编程教程 · 手机编辑");
    await content(phone).fill(literal);
    assert.equal(await defaults(phone).inputValue(), "course");
    await noOverflow(phone);
    assert.equal(await content(phone).evaluate((el) => getComputedStyle(el).fontSize), "16px");
    await capture(phone, { path: path.join(output, "templates-editing-mobile.png"), fullPage: true });
    await phone.setViewportSize({ width: 360, height: 740 });
    await noOverflow(phone);
    await phone.emulateMedia({ reducedMotion: "reduce" });
    await editing.selectOption("");
    await button(phone, "创建副本").click();
    assert.equal(await name(phone).evaluate((el) => document.activeElement === el), true);
    await name(phone).fill("手机副本");
    // Keyboard Tab reaches the actual editable body, not a hidden desktop list.
    await name(phone).focus();
    await phone.keyboard.press("Tab");
    assert.equal(await content(phone).evaluate((el) => document.activeElement === el), true);
    await save(phone);
    await editing.selectOption("course");
    await button(phone, "删除模板").click();
    await phone.getByRole("dialog", { name: "删除总结模板", exact: true }).waitFor();
    await noOverflow(phone);
    await capture(phone, { path: path.join(output, "templates-delete-mobile.png") });
    await phone.keyboard.press("Escape");
    await phone.setViewportSize({ width: 720, height: 1000 });
    await noOverflow(phone);
    results.push("390/360px、键盘顺序、默认与编辑选择分离、移动删除、减少动效和 720px 重排");

    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "summary-template-results.json"), JSON.stringify({ status: "passed", results, errors }, null, 2));
    console.log(JSON.stringify({ status: "passed", results, errors }));
  } catch (e) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const states = await Promise.all(pages.map((page) => page.evaluate(() => ({
      url: location.href, text: document.body.innerText, bridge: Boolean(window.__TAURI_INTERNALS__),
      calls: window.__TEST_CALLS__?.map((call) => call.cmd),
    })).catch((error) => ({ error: String(error) }))));
    await fs.writeFile(path.join(output, "summary-template-failure-state.json"), JSON.stringify({ errors, states }, null, 2));
    await fs.writeFile(path.join(output, "summary-template-failure.txt"), e.stack || String(e));
    throw e;
  } finally {
    await browser.close();
  }
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
