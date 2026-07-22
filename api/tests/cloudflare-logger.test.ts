import { describe, expect, it } from "vitest";
import { createCloudflareLogger } from "../src/cloudflare/logger.js";

describe("Cloudflare structured logger", () => {
  it("emits one JSON record without process environment or secret bindings", () => {
    const lines: string[] = [];
    const logger = createCloudflareLogger({
      serviceVersion: "release-1",
      deploymentEnvironment: "prototype",
      write: (line) => lines.push(line),
    });
    logger.emit({
      severity: "INFO",
      body: "Cloudflare bounded job completed.",
      eventName: "shareslices.cloudflare.job.completed",
      attributes: { "shareslices.job.id": "job-1" },
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      severityText: "INFO",
      eventName: "shareslices.cloudflare.job.completed",
      resource: {
        "service.name": "shareslices-api",
        "service.version": "release-1",
        "deployment.environment.name": "prototype",
      },
    });
  });
});
