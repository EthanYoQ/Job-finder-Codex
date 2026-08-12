import { accessSync, constants } from "node:fs";
import { chromium } from "playwright-core";

const executablePath = "/usr/bin/chromium";
accessSync(executablePath, constants.X_OK);
if (process.getuid?.() === 0) throw new Error("formal Chromium smoke must run as a non-root user");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-dev-shm-usage"] });
await browser.close();
console.log(JSON.stringify({ status: "PASS", executablePath }));
