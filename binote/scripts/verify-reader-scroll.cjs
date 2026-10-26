const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, launchOptions } = require("./browser-runtime.cjs");
const { fixture, base, output } = require("./verify-ui.cjs");

// 等待浏览器派发滚动并完成 React 提交，不依赖固定延时。
async function scroll(page, target) {
  return page.evaluate(async (target) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, target === "bottom" ? max : target);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return scrollY;
  }, target);
}

async function backState(page) {
  return page.locator("a.back-line").evaluate((link) => {
    const rect = link.getBoundingClientRect();
    const style = getComputedStyle(link);
    return {
      visible: rect.top >= 0 && rect.bottom <= innerHeight &&
        Number(style.opacity) > 0 && style.visibility !== "hidden",
      interactive: style.pointerEvents !== "none",
      height: rect.height,
      y: scrollY,
      top: rect.top,
      className: link.className,
      focused: document.activeElement === link,
      max: document.documentElement.scrollHeight - innerHeight,
    };
  });
}

(async () => {
  const browser = await chromium.launch(launchOptions);
  const results = [];
  const errors = [];
  try {
    await fs.mkdir(output, { recursive: true });
    for (const width of [1440, 390, 360]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: width < 640,
        hasTouch: width < 640,
        reducedMotion: width === 360 ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await fixture(page, { mobile: width < 640 });
      await page.goto(base + "/#/");
      await page.locator("[data-note-row]").first().waitFor();
      await page.evaluate(() => {
        const note = window.__TEST_BACKEND__.notes[0];
        note.summary = Array.from({ length: 40 }, (_, index) =>
          `## 阅读章节 ${index + 1}\n\n${"长笔记用于验证阅读时返回入口的滚动行为。".repeat(8)}`,
        ).join("\n\n");
        note.transcript = Array.from({ length: 150 }, (_, index) =>
          `[${index}:00] ${"原始转录用于验证回滑返回笔记库。".repeat(4)}`,
        ).join("\n\n");
      });
      await page.locator("[data-note-row]").first().getByRole("heading").click();
      await page.locator(".summary-content").waitFor();
      assert.ok((await backState(page)).visible, "顶部显示原有返回入口");

      for (const tab of ["AI 总结", "原始转录"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const bottom = await scroll(page, "bottom");
        assert.ok(bottom > 1000, "使用真实长正文触发窗口滚动");
        const downState = await backState(page);
        assert.equal(downState.visible, false, `${width}px ${tab}：向下阅读时收起入口 ${JSON.stringify(downState)}`);
        await scroll(page, bottom - 1);
        const state = await backState(page);
        assert.ok(state.visible && state.interactive, `${width}px ${tab}：底部回滑 1 像素立即显示并可点击`);
        assert.equal(state.y, bottom - 1, "返回入口不改变滚动位置");
        assert.ok(state.height >= 44, "保留至少 44px 的触摸区域");
        await page.evaluate(() => dispatchEvent(new Event("scroll")));
        assert.ok((await backState(page)).visible, "相同位置的滚动事件不收起入口");
        await page.screenshot({ path: path.join(output, `reader-back-${width}-${tab === "AI 总结" ? "summary" : "transcript"}.png`), animations: "disabled" });

        await scroll(page, bottom);
        assert.equal((await backState(page)).visible, false, "继续向下阅读立即收起");
        await scroll(page, Math.floor(bottom / 2));
        assert.ok((await backState(page)).visible, "中部回滑同样显示");
        await scroll(page, Math.floor(bottom / 2) + 10);
        assert.equal((await backState(page)).visible, false);
        await scroll(page, Math.floor(bottom / 2) + 9);
        assert.ok((await backState(page)).visible, "中部反向滚动 1 像素显示");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        results.push(`${width}px ${tab}：顶部、底部/中部回滑 1px、继续下滑、无位移/横向溢出`);
      }

      await scroll(page, "bottom");
      const beforeFocus = await page.evaluate(() => scrollY);
      await page.locator("a.back-line").focus();
      assert.ok((await backState(page)).visible, "键盘聚焦时入口可见");
      assert.equal(await page.evaluate(() => scrollY), beforeFocus, "聚焦不会跳回正文顶部");
      await page.keyboard.press("Enter");
      await page.locator("[data-note-row]").first().waitFor();
      assert.equal(await page.evaluate(() => scrollY), 0, "返回笔记库正常复位");
      results.push(`${width}px：键盘聚焦和 Enter 返回可用${width === 360 ? "，减少动效下无等待" : ""}`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "reader-scroll-results.json"), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
