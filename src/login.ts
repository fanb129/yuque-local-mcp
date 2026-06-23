import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";

const config = loadConfig();
const origin = process.argv[2] || config.allowedBooks[0]?.origin || "https://www.yuque.com";

const context = await chromium.launchPersistentContext(config.browser.profileDir, {
  headless: false,
  slowMo: config.browser.slowMoMs,
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: false
});

context.setDefaultTimeout(config.browser.defaultTimeoutMs);

const page = await context.newPage();
await page.goto(origin, { waitUntil: "domcontentloaded" });

console.log(`Yuque login browser opened: ${page.url()}`);
console.log("Log in manually in the browser window. Press Enter here after login to close it.");

const rl = readline.createInterface({ input, output });
await rl.question("");
rl.close();

await context.close();
console.log("Yuque login browser closed.");
