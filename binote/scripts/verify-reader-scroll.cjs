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

async function navigationState(page) {
  return page.locator(".reader-navigation").evaluate((navigation) => {
    const rect = navigation.getBoundingClientRect();
    const title = navigation.querySelector(".reader-navigation-title");
    const titleRect = title.getBoundingClientRect();
    const link = navigation.querySelector("a.back-line");
    const style = getComputedStyle(navigation);
    const hit = document.elementFromPoint(innerWidth / 2, rect.top + rect.height / 2);
    return {
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      viewportWidth: document.documentElement.clientWidth,
      height: rect.height,
      position: style.position,
      background: style.backgroundColor,
      linkBackground: getComputedStyle(link).backgroundColor,
      titleVisible: getComputedStyle(title).visibility === "visible" && titleRect.width > 0,
      titleLeft: titleRect.left,
      coversFullRow: Boolean(hit && navigation.contains(hit)),
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
      assert.equal(await page.locator(".reader-navigation").count(), 1, "阅读页返回入口应位于独立导航栏");
      const initialNav = await navigationState(page);
      assert.equal(initialNav.position, "sticky", "导航栏应吸附在视口顶部");
      assert.ok(Math.abs(initialNav.width - initialNav.viewportWidth) <= 1, "导航栏应铺满视口宽度");
      assert.ok(initialNav.height >= 44, "导航栏应为触摸操作留出空间");
      assert.equal(initialNav.background, "rgb(255, 255, 255)", "使用统一白色导航背景");
      assert.equal(initialNav.linkBackground, "rgba(0, 0, 0, 0)", "返回入口不使用突兀的独立底色");
      assert.ok(initialNav.titleVisible, "导航栏显示笔记详情上下文");

      for (const tab of ["AI 总结", "原始转录"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const bottom = await scroll(page, "bottom");
        assert.ok(bottom > 1000, "使用真实长正文触发窗口滚动");
        const downState = await backState(page);
        assert.equal(downState.visible, false, `${width}px ${tab}：向下阅读时收起入口 ${JSON.stringify(downState)}`);
        const downNav = await navigationState(page);
        assert.ok(Math.abs(downNav.top) <= 1 && downNav.coversFullRow, "滚动后独立导航栏应完整占据顶部一行");
        assert.ok(downNav.titleVisible, "返回入口收起后保留笔记详情标题");
        assert.equal(downNav.height, initialNav.height, "入口收起时导航栏高度保持不变");
        assert.equal(downNav.titleLeft, initialNav.titleLeft, "入口显隐不改变导航布局");
        await scroll(page, bottom - 1);
        const state = await backState(page);
        assert.ok(state.visible && state.interactive, `${width}px ${tab}：底部回滑 1 像素立即显示并可点击`);
        assert.equal(state.y, bottom - 1, "返回入口不改变滚动位置");
        assert.ok(state.height >= 44, "保留至少 44px 的触摸区域");
        const upNav = await navigationState(page);
        assert.equal(upNav.height, downNav.height, "回滑显示入口时导航栏高度保持不变");
        assert.equal(upNav.titleLeft, downNav.titleLeft, "回滑显示入口不挤动导航标题");
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
        await page.screenshot({ path: path.join(output, `reader-navigation-${width}-${tab === "AI 总结" ? "summary" : "transcript"}-mid.png`), animations: "disabled" });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width === 1440 && tab === "AI 总结") {
          await scroll(page, 0);
          await page.locator(".reader-toc nav button").nth(5).click();
          await page.waitForFunction(() => {
            const navigation = document.querySelector(".reader-navigation");
            const heading = [...document.querySelectorAll(".summary-content h2")]
              .find((item) => item.textContent === "阅读章节 6");
            if (!navigation || !heading) return false;
            const navBottom = navigation.getBoundingClientRect().bottom;
            const headingTop = heading.getBoundingClientRect().top;
            return headingTop >= navBottom - 1 && headingTop <= navBottom + 64;
          });
          const geometry = await page.evaluate(() => ({
            navBottom: document.querySelector(".reader-navigation").getBoundingClientRect().bottom,
            tocTop: document.querySelector(".reader-toc").getBoundingClientRect().top,
          }));
          assert.ok(geometry.tocTop >= geometry.navBottom, "右侧目录不应被顶部导航栏遮住");
          results.push("桌面目录：章节跳转与目录本身均不被顶部导航遮挡");
        }
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
