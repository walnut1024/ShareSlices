import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { artifactNameFromFile, prepareArtifactUpload } from "./upload-file-preparation";

describe("artifact upload file preparation", () => {
  it("packages an HTML file as a ZIP with a root index.html", async () => {
    const source = new File(["<!doctype html><title>Report</title>"], "quarterly-report.html", { type: "text/html" });

    const prepared = await prepareArtifactUpload(source);

    expect(prepared.name).toBe("quarterly-report.zip");
    expect(prepared.type).toBe("application/zip");
    const entries = unzipSync(new Uint8Array(await readFile(prepared)));
    expect(Object.keys(entries)).toEqual(["index.html"]);
    expect(new TextDecoder().decode(entries["index.html"])).toBe("<!doctype html><title>Report</title>");
  });

  it("handles the htm extension case-insensitively", async () => {
    const source = new File(["<h1>Status</h1>"], "status.HTM", { type: "text/html" });

    const prepared = await prepareArtifactUpload(source);

    expect(prepared.name).toBe("status.zip");
    expect(artifactNameFromFile(source.name)).toBe("status");
  });

  it("passes an existing ZIP through unchanged", async () => {
    const source = new File(["zip"], "prepared.zip", { type: "application/zip" });

    await expect(prepareArtifactUpload(source)).resolves.toBe(source);
    expect(artifactNameFromFile(source.name)).toBe("prepared");
  });
});

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
