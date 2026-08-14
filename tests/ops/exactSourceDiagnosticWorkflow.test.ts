import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/exact-source-diagnostic.yml", "utf8");
const productionWorkflow = readFileSync(".github/workflows/production-image.yml", "utf8");
const privateCloudWorkflow = readFileSync(".github/workflows/private-cloud-build-gate.yml", "utf8");

describe("exact-source diagnostic workflow", () => {
  it("is non-push and declares one bounded source selection input for dispatch and workflow call", () => {
    expect(workflow).toMatch(/^name: Exact source diagnostic$/m);
    expect(workflow).toMatch(/^on:\s*\n\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+source_ids:/m);
    expect(workflow).toMatch(/^\s+workflow_call:\s*\n\s+inputs:\s*\n\s+source_ids:/m);
    expect(workflow).not.toMatch(/^\s+(?:push|pull_request):/m);
    expect(workflow).toContain("NON_CERTIFYING");
    expect(workflow).toContain("source IDs (1-15)");
    expect(workflow).toContain('test "${#selected_sources[@]}" -le 15');
    expect(workflow).toContain("group: exact-source-diagnostic-${{ github.ref }}");
    expect(workflow).not.toContain("group: exact-source-diagnostic-${{ github.ref }}-${{ inputs.source_ids }}");
    expect(privateCloudWorkflow).toContain("comma-separated, 1-15");
  });

  it("captures bounded same-container resource telemetry with the diagnostic evidence", () => {
    expect(workflow).toContain("runtime-resources.jsonl");
    expect(workflow).toContain("/sys/fs/cgroup/memory.current");
    expect(workflow).toContain("/sys/fs/cgroup/pids.current");
    expect(workflow).toContain("du -sk /tmp");
    expect(workflow).toContain("braveProcesses");
    expect(workflow).toContain("telemetry_samples");
    expect(workflow).toContain('"sampleError":"METRICS_UNAVAILABLE"');
    expect(workflow).toContain("telemetry.length < 3");
    expect(workflow).toContain("report.executionOrderMatchesSession !== true");
    expect(workflow).toContain('source.sourceId === "source-xiuzheng-social"');
  });

  it("is dispatchable before default-branch registration through the existing private cloud workflow", () => {
    expect(privateCloudWorkflow).toMatch(/^\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+source_ids:/m);
    expect(privateCloudWorkflow).toContain("uses: ./.github/workflows/exact-source-diagnostic.yml");
    expect(privateCloudWorkflow).toContain("source_ids: ${{ inputs.source_ids }}");
    expect(privateCloudWorkflow).toContain("inputs.source_ids == ''");
    expect(privateCloudWorkflow).toContain("inputs.source_ids != ''");
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
