import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/exact-source-diagnostic.yml", "utf8");
const productionWorkflow = readFileSync(".github/workflows/production-image.yml", "utf8");

describe("exact-source diagnostic workflow", () => {
  it("is manual-only and declares one bounded source selection input", () => {
    expect(workflow).toMatch(/^name: Exact source diagnostic$/m);
    expect(workflow).toMatch(/^on:\s*\n\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+source_ids:/m);
    expect(workflow).not.toMatch(/^\s+(?:push|pull_request):/m);
    expect(workflow).toContain("NON_CERTIFYING");
  });

  it("keeps the formal production workflow off ordinary development pushes and pull requests", () => {
    const triggerBlock = productionWorkflow.slice(
      productionWorkflow.indexOf("on:"),
      productionWorkflow.indexOf("permissions:")
    );
    expect(triggerBlock).toContain("branches:");
    expect(triggerBlock).toContain("- main");
    expect(triggerBlock).toContain("- qualification/launch-cohort-round-1");
    expect(triggerBlock).toContain("- qualification/launch-cohort-round-2");
    expect(triggerBlock).not.toContain("pull_request:");
  });
});
