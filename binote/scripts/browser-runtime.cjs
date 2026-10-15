const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let playwright;
try {
  playwright = require(process.env.BINOTE_PLAYWRIGHT_MODULE || "playwright");
} catch {
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
  );
}
const candidates = [
  process.env.BINOTE_BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = candidates.find(
  (candidate) => candidate && fs.existsSync(candidate),
);
module.exports = {
  chromium: playwright.chromium,
  launchOptions: {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  },
};
