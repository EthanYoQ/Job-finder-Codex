import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const shell = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\sh.exe" : "sh";
const renderer = resolve(process.cwd(), "ops/render-nginx-config.sh");

function render(hostname: string, port: string) {
  const root = mkdtempSync(resolve(tmpdir(), "jobfinder-nginx-render-"));
  const template = resolve(root, "template.conf");
  const output = resolve(root, "output.conf");
  writeFileSync(template, "server_name ${PUBLIC_HOSTNAME}; return 308 https://${PUBLIC_HTTPS_AUTHORITY}$request_uri;\n");
  const result = spawnSync(shell, [renderer], { encoding: "utf8", env: { ...process.env, PUBLIC_HOSTNAME: hostname,
    PUBLIC_HTTPS_PORT: port, NGINX_TEMPLATE_PATH: template.replaceAll("\\", "/"),
    NGINX_RENDERED_CONFIG_PATH: output.replaceAll("\\", "/") } });
  return { result, output };
}

describe("nginx production config renderer", () => {
  it("includes a non-default public TLS port without expanding nginx request variables", () => {
    const { result, output } = render("jobs.example.test", "18443");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, "utf8").replaceAll("\r\n", "\n")).toBe(
      "server_name jobs.example.test; return 308 https://jobs.example.test:18443$request_uri;\n");
  });

  it("omits the default port and rejects hostname injection", () => {
    const valid = render("jobs.example.test", "443");
    expect(valid.result.status, valid.result.stderr).toBe(0);
    expect(readFileSync(valid.output, "utf8").replaceAll("\r\n", "\n")).toContain("https://jobs.example.test$request_uri");
    expect(render("jobs.example.test;return 200", "443").result.status).not.toBe(0);
    expect(render("jobs.example.test", "70000").result.status).not.toBe(0);
  });
});
