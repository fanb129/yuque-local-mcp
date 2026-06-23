import fs from "node:fs";
import { loadConfig } from "./config.js";

const config = loadConfig();

console.log("yuque-local-mcp doctor");
console.log(JSON.stringify(config, null, 2));

if (!fs.existsSync(config.browser.profileDir)) {
  console.log(`Profile directory will be created on first browser launch: ${config.browser.profileDir}`);
}

if (!fs.existsSync(config.cacheDir)) {
  console.log(`Cache directory will be created on first cache write: ${config.cacheDir}`);
}

console.log("Allowed books:");
for (const book of config.allowedBooks) {
  console.log(`- ${book.name}: ${book.origin}/${book.group}/${book.book}`);
}
