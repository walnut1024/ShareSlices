/// <reference lib="webworker" />

import type { UploadPolicy } from "../api/artifacts";
import { preflightArchive } from "./archive-preflight";

type PreflightRequest = { id: string; bytes: ArrayBuffer; policy: UploadPolicy };

self.onmessage = async (event: MessageEvent<PreflightRequest>) => {
  const { id, bytes, policy } = event.data;
  try {
    const report = await preflightArchive(new Uint8Array(bytes), policy);
    self.postMessage({ id, report });
  } catch {
    self.postMessage({ id, error: "Archive preflight could not run." });
  }
};
