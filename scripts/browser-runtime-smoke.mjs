import { accessSync, constants } from "node:fs";
import { inspectFormalBrowserReady, FORMAL_CHROMIUM_PATH } from "../src/readiness/formalBrowserPreflight.ts";

accessSync(FORMAL_CHROMIUM_PATH, constants.X_OK);
if (process.getuid?.() === 0) throw new Error("formal Chromium smoke must run as a non-root user");
const engineVersion = await inspectFormalBrowserReady();
console.log(JSON.stringify({ status: "PASS", executablePath: FORMAL_CHROMIUM_PATH, engineVersion }));
