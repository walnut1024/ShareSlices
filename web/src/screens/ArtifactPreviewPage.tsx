import { ArtifactPlayer } from "../components/ArtifactPlayer";
import { versionContentUrl } from "../artifacts/preview";

export function ArtifactPreviewPage({ versionId }: { versionId: string }) {
  return (
    <main className="size-screen overflow-hidden bg-neutral-950">
      <ArtifactPlayer contentUrl={versionContentUrl(versionId)} />
    </main>
  );
}
