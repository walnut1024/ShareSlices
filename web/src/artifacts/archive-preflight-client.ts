import type { UploadPolicy } from "../api/artifacts";
import type { ValidationReport } from "./archive-preflight";

type WorkerResult = { id: string; report?: ValidationReport; error?: string };

export async function preflightArtifactZip(
  file: File,
  policy: UploadPolicy,
  signal?: AbortSignal
): Promise<ValidationReport> {
  if (signal?.aborted) throw new DOMException("Archive preflight was cancelled.", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archive-preflight.worker.ts", import.meta.url), { type: "module" });
    const id = crypto.randomUUID();
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Archive preflight was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.report) resolve(event.data.report);
      else reject(new Error(event.data.error ?? "Archive preflight could not run."));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("Archive preflight could not run."));
    };
    void readFile(file).then((bytes) => {
      if (!signal?.aborted) worker.postMessage({ id, bytes, policy }, [bytes]);
    }).catch(() => {
      cleanup();
      reject(new Error("Archive preflight could not read the ZIP."));
    });
  });
}

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
