import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const contract = JSON.parse(readFileSync(new URL("../src/security/runtimeExposureContract.json", import.meta.url), "utf8"));
const { formalExecutables, riskyExecutables } = contract;
if (!Array.isArray(formalExecutables) || !Array.isArray(riskyExecutables) ||
    !formalExecutables.every((value) => typeof value === "string") ||
    !riskyExecutables.every((value) => typeof value === "string") || process.execPath !== formalExecutables[0]) {
  throw new Error("Runtime exposure executable contract is invalid");
}
const sourceRoots = ["src", "scripts", "ops"];
for (const root of sourceRoots) if (!existsSync(root)) throw new Error(`Required source root is missing: ${root}`);

const sourceFiles = sourceRoots.flatMap((root) => walk(root)).filter((path) => /\.(?:[cm]?[jt]s|sh)$/u.test(path));
const forbiddenSpawnReferences = [];
for (const path of sourceFiles) {
  const text = readFileSync(path, "utf8");
  for (const executable of riskyExecutables) {
    const escaped = executable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (new RegExp(`(?:spawn|spawnSync|execFile|execFileSync)\\s*\\(\\s*["']${escaped}["']`, "u").test(text)) {
      forbiddenSpawnReferences.push(`${path}:${executable}`);
    }
  }
}

const dynamicLibraries = Object.fromEntries(formalExecutables.map((path) => [path, lddLibraries(path)]));
const raw = {
  schemaVersion: 1,
  status: "PASS",
  platform: process.platform,
  architecture: process.arch,
  uid: process.getuid?.() ?? -1,
  effectiveCapabilities: readStatusField("CapEff"),
  noNewPrivileges: readStatusField("NoNewPrivs"),
  rootMountOptions: mountOptionsFor("/"),
  tmpMountOptions: mountOptionsFor("/tmp"),
  dbusEnvironment: ["DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS"].filter((key) => process.env[key]),
  dbusSockets: ["/run/dbus/system_bus_socket", "/var/run/dbus/system_bus_socket"].filter(existsSync),
  blockDevices: walk("/dev", 2).filter((path) => safeIsBlockDevice(path)),
  forbiddenSpawnReferences: forbiddenSpawnReferences.sort(),
  minizipLibraries: ["/lib", "/usr/lib"].flatMap((path) => walk(path, 4))
    .filter((path) => /(?:^|\/)libminizip(?:\.so|$)/u.test(path)).sort(),
  executablePaths: Object.fromEntries(riskyExecutables.map((name) => [name, commandPath(name)])),
  elfClasses: Object.fromEntries(formalExecutables.map((path) => [path, elfClass(path)])),
  dynamicLibraries,
  capturedAt: new Date().toISOString()
};
process.stdout.write(`${JSON.stringify(raw)}\n`);

function walk(root, depth = 12) {
  if (depth < 0 || !existsSync(root)) return [];
  const output = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    output.push(path);
    if (lstatSync(path).isDirectory()) output.push(...walk(path, depth - 1));
  }
  return output;
}

function safeIsBlockDevice(path) {
  try { return lstatSync(path).isBlockDevice(); } catch { return true; }
}

function readStatusField(name) {
  const line = readFileSync("/proc/self/status", "utf8").split("\n").find((entry) => entry.startsWith(`${name}:`));
  return line?.split(":", 2)[1]?.trim() ?? "MISSING";
}

function mountOptionsFor(target) {
  const line = readFileSync("/proc/self/mountinfo", "utf8").split("\n")
    .find((entry) => entry.split(" ")[4] === target);
  if (!line) throw new Error(`Mount evidence is missing for ${target}`);
  const [before, after] = line.split(" - ", 2);
  if (!before || !after) throw new Error(`Mount evidence is malformed for ${target}`);
  return [...new Set([...before.split(" ")[5].split(","), ...after.split(" ")[2].split(",")])].sort();
}

function commandPath(name) {
  const result = spawnSync("sh", ["-c", `command -v -- ${name}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function elfClass(path) {
  const bytes = readFileSync(path);
  return bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46 ? bytes[4] : 0;
}

function lddLibraries(path) {
  const result = spawnSync("ldd", [path], { encoding: "utf8" });
  if (result.status !== 0 || /not found|undefined symbol/iu.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(`ldd failed for ${path}`);
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}
