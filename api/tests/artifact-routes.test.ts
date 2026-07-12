import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/app.js";
import { ArtifactIntakeError } from "../src/application/artifacts/artifact-intake.js";
import { ArtifactManagementError } from "../src/application/artifacts/artifact-management.js";
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
      list: vi.fn().mockResolvedValue({ artifacts: [artifact], nextPageToken: null }),
      get: vi.fn().mockResolvedValue(artifact),
      listReadyVersions: vi.fn().mockResolvedValue([
        { id: "version-2", versionNumber: 2, state: "ready" }
      ]),
      rename: vi.fn().mockResolvedValue({ ...artifact, name: "Renamed" }),
      setShareExpiration: vi.fn().mockResolvedValue(artifact),
      delete: vi.fn().mockResolvedValue(undefined)
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

  it("validates and applies Artifact list pagination and filters", async () => {
    const dependencies = managementDependencies();
    dependencies.management.list.mockResolvedValue({
      artifacts: [{ ...await dependencies.management.get(), id: "artifact-1", processingState: "ready", publication: { id: "p-1" } }],
      nextPageToken: null
    });
    const app = buildApp({ artifact: dependencies } as never);

    const response = await app.request("/api/artifacts?publication=published&processing=ready&pageSize=1&pageToken=1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifacts: [{ id: "artifact-1" }],
      nextPageToken: null
    });
    expect(dependencies.management.list).toHaveBeenCalledWith("owner-1", {
      publication: "published", processing: "ready", pageSize: 1, pageToken: "1"
    });
    expect((await app.request("/api/artifacts?pageSize=0")).status).toBe(400);
    expect((await app.request("/api/artifacts?publication=private")).status).toBe(400);
  });

  it("lists ready Versions through an owner-scoped resource route", async () => {
    const dependencies = managementDependencies();
    const app = buildApp({ artifact: dependencies } as never);
    const response = await app.request("/api/artifacts/artifact-1/versions");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      versions: [{ id: "version-2", versionNumber: 2, state: "ready" }]
    });
    expect(dependencies.management.listReadyVersions).toHaveBeenCalledWith("owner-1", "artifact-1");
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

  it("returns the configured archive limit and corrective action for synchronous size rejection", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    dependencies.intake.create.mockImplementation(async (input) => {
      for await (const _chunk of input.body) {
        // Consume the multipart stream before simulating intake rejection.
      }
      await input.completed;
      throw new ArtifactIntakeError("archive_too_large");
    });
    const app = buildApp({ artifact: dependencies } as never);
    const form = new FormData();
    form.append("name", "Too large");
    form.append("file", new Blob(["zip-content"], { type: "application/zip" }), "artifact.zip");

    const response = await app.request("/api/artifacts", {
      method: "POST",
      headers: { "Idempotency-Key": "too-large-key" },
      body: form
    });

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "archive_too_large",
        action: "Reduce the ZIP below the upload limit and try again.",
        details: { limitBytes: 52_428_800 }
      }
    });
    expect(body.error.details).not.toHaveProperty("actualBytes");
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

  it("streams an Artifact Upload session with an optional Entry", async () => {
    const dependencies = artifactDependencies({ user: { id: "owner-1" } });
    dependencies.recovery.replace.mockImplementation(async (input) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) {
        chunks.push(Buffer.from(chunk));
      }
      await input.completed;
      await expect(input.requestedEntry).resolves.toBe("report.html");
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
    form.append("entry", "report.html");
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
    expect(dependencies.management.list).toHaveBeenCalledWith("owner-1", { pageSize: 30 });
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

  it("updates Share link expiration and deletes an eligible Artifact", async () => {
    const dependencies = managementDependencies();
    const app = buildApp({ artifact: dependencies } as never);
    const expiresAt = "2026-08-08T23:59:59.999Z";

    const expiration = await app.request("/api/artifacts/artifact-1/share-link", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresAt })
    });
    const deleted = await app.request("/api/artifacts/artifact-1", { method: "DELETE" });

    expect(expiration.status).toBe(200);
    expect(dependencies.management.setShareExpiration).toHaveBeenCalledWith("owner-1", "artifact-1", expiresAt);
    expect(deleted.status).toBe(204);
    expect(dependencies.management.delete).toHaveBeenCalledWith("owner-1", "artifact-1");
  });

  it("rejects invalid Share expiration input and enforces ownership", async () => {
    const dependencies = managementDependencies();
    const app = buildApp({ artifact: dependencies } as never);

    for (const body of [{}, { expiresAt: "not-a-date" }, { expiresAt: 42 }]) {
      const response = await app.request("/api/artifacts/artifact-1/share-link", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(400);
    }
    expect(dependencies.management.setShareExpiration).not.toHaveBeenCalled();

    const unauthorizedDependencies = managementDependencies();
    unauthorizedDependencies.authApi.getSession.mockResolvedValue(null);
    const unauthorized = buildApp({ artifact: unauthorizedDependencies } as never);
    const response = await unauthorized.request("/api/artifacts/artifact-1/share-link", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresAt: null })
    });
    expect(response.status).toBe(401);
    expect(unauthorizedDependencies.management.setShareExpiration).not.toHaveBeenCalled();

    const otherOwnerDependencies = managementDependencies();
    otherOwnerDependencies.authApi.getSession.mockResolvedValue({ user: { id: "other-owner" } });
    otherOwnerDependencies.management.get.mockRejectedValue(new ArtifactManagementError("artifact_not_found"));
    otherOwnerDependencies.management.setShareExpiration.mockRejectedValue(
      new ArtifactManagementError("artifact_not_found")
    );
    const otherOwner = buildApp({ artifact: otherOwnerDependencies } as never);
    expect((await otherOwner.request("/api/artifacts/artifact-1")).status).toBe(404);
    const edit = await otherOwner.request("/api/artifacts/artifact-1/share-link", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresAt: null })
    });
    expect(edit.status).toBe(404);
  });
});
