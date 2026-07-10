import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/app.js";
import { apiLogger } from "../src/logging/index.js";

function artifactDependencies(session: { user: { id: string } } | null) {
  return {
    authApi: {
      getSession: vi.fn().mockResolvedValue(session)
    },
    repositories: {
      uploadPolicies: {
        getActive: vi.fn().mockResolvedValue({
          revision: "v0.0.1-default",
          archiveSizeBytes: 52_428_800,
          expandedSizeBytes: 209_715_200,
          fileCount: 1000,
          singleFileSizeBytes: 52_428_800,
          formats: [
            { extension: ".html", contentType: "text/html", validationKind: "utf8_text" },
            { extension: ".css", contentType: "text/css", validationKind: "utf8_text" }
          ]
        })
      }
    },
    intake: { create: vi.fn() },
    recovery: { retry: vi.fn(), replace: vi.fn() }
  };
}

function managementDependencies() {
  const artifact = {
    id: "artifact-1",
    name: "Report",
    processingState: "accepted",
    shareLink: { url: "http://127.0.0.1:7456/a/share-slug-0000000001/", state: "active" },
    readyVersion: null,
    publication: null,
    failure: null,
    allowedActions: ["rename", "copy_share_link"]
  };
  return {
    authApi: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner-1" } }) },
    repositories: artifactDependencies({ user: { id: "owner-1" } }).repositories,
    management: {
      list: vi.fn().mockResolvedValue([artifact]),
      get: vi.fn().mockResolvedValue(artifact),
      rename: vi.fn().mockResolvedValue({ ...artifact, name: "Renamed" })
    }
  };
}

describe("Artifact routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiLogger, "emit").mockImplementation(() => undefined);
  });

  it("requires a management session for upload-policy discovery", async () => {
    const dependencies = artifactDependencies(null);
    const app = buildApp({ artifact: dependencies } as never);

    const response = await app.request("/api/artifact-upload-policies/current");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthenticated" } });
    expect(dependencies.repositories.uploadPolicies.getActive).not.toHaveBeenCalled();
  });

  it("returns the complete active policy and opaque revision", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    const app = buildApp({ artifact: dependencies } as never);

    const response = await app.request("/api/artifact-upload-policies/current");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      policy: {
        revision: "v0.0.1-default",
        maxArchiveBytes: 52_428_800,
        maxExpandedBytes: 209_715_200,
        maxFileCount: 1000,
        maxFileBytes: 52_428_800,
        enabledExtensions: [".html", ".css"]
      }
    });
    expect(dependencies.authApi.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableRefresh: true }
    });
  });

  it("streams multipart input into the Artifact intake service", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    dependencies.intake.create.mockImplementation(async (input) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) {
        chunks.push(Buffer.from(chunk));
      }
      await input.completed;
      expect(await input.name).toBe("Report");
      expect(Buffer.concat(chunks)).toEqual(Buffer.from("zip-content"));
      expect(input.policy.revision).toBe("v0.0.1-default");
      return {
        artifactId: "artifact-1",
        uploadSessionId: "upload-1",
        processingState: "accepted",
        shareLink: { url: "http://127.0.0.1:7456/a/share-slug-0000000001/", state: "active" }
      };
    });
    const app = buildApp({ artifact: dependencies } as never);
    const form = new FormData();
    form.append("name", "Report");
    form.append("file", new Blob(["zip-content"], { type: "application/zip" }), "artifact.zip");

    const response = await app.request("/api/artifacts", {
      method: "POST",
      headers: { "Idempotency-Key": "create-key" },
      body: form
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      artifactId: "artifact-1",
      processingState: "accepted"
    });
    expect(dependencies.intake.create).toHaveBeenCalledOnce();
  });

  it("rejects a missing idempotency key before parsing multipart input", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    const app = buildApp({ artifact: dependencies } as never);

    const response = await app.request("/api/artifacts", { method: "POST" });

    expect(response.status).toBe(400);
    expect(dependencies.intake.create).not.toHaveBeenCalled();
  });

  it("routes manual Retry without exposing Processing Jobs", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    dependencies.recovery.retry.mockResolvedValue({
      artifactId: "artifact-1",
      uploadSessionId: "upload-1",
      processingState: "accepted",
      shareLink: { url: "http://127.0.0.1:7456/a/share-slug-0000000001/", state: "active" }
    });
    const app = buildApp({ artifact: dependencies } as never);

    const response = await app.request("/api/upload-sessions/upload-1:retry", {
      method: "POST",
      headers: { "Idempotency-Key": "retry-key" }
    });

    expect(response.status).toBe(202);
    expect(dependencies.recovery.retry).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      uploadSessionId: "upload-1",
      idempotencyKey: "retry-key"
    });
  });

  it("streams a file-only replacement upload", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    dependencies.recovery.replace.mockImplementation(async (input) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) {
        chunks.push(Buffer.from(chunk));
      }
      await input.completed;
      expect(Buffer.concat(chunks)).toEqual(Buffer.from("replacement"));
      return {
        artifactId: "artifact-1",
        uploadSessionId: "upload-2",
        processingState: "accepted",
        shareLink: { url: "http://127.0.0.1:7456/a/share-slug-0000000001/", state: "active" }
      };
    });
    const app = buildApp({ artifact: dependencies } as never);
    const form = new FormData();
    form.append("file", new Blob(["replacement"], { type: "application/zip" }), "replacement.zip");

    const response = await app.request("/api/artifacts/artifact-1/upload-sessions", {
      method: "POST",
      headers: { "Idempotency-Key": "replace-key" },
      body: form
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ uploadSessionId: "upload-2" });
  });

  it("lists and reads only through the signed-in owner's management projection", async () => {
    const dependencies = managementDependencies();
    const app = buildApp({ artifact: dependencies } as never);

    const listResponse = await app.request("/api/artifacts");
    const detailResponse = await app.request("/api/artifacts/artifact-1");

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({ artifacts: [{ id: "artifact-1" }] });
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({ artifact: { id: "artifact-1" } });
    expect(dependencies.management.list).toHaveBeenCalledWith("owner-1");
    expect(dependencies.management.get).toHaveBeenCalledWith("owner-1", "artifact-1");
  });

  it("updates the mutable name through PATCH", async () => {
    const dependencies = managementDependencies();
    const app = buildApp({ artifact: dependencies } as never);

    const response = await app.request("/api/artifacts/artifact-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ artifact: { id: "artifact-1", name: "Renamed" } });
    expect(dependencies.management.rename).toHaveBeenCalledWith("owner-1", "artifact-1", "Renamed");
  });
});
