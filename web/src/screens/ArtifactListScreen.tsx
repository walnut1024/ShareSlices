import { ArrowRight, FilePlus2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Artifact, listArtifacts } from "../api/artifacts";
import { ArtifactStatus } from "../components/ArtifactStatus";
import { Alert } from "../components/ui/alert";

export function ArtifactListScreen() {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listArtifacts()
      .then((value) => active && setArtifacts(value))
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Artifacts could not be loaded."));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-950">Artifacts</h1>
        </div>
        <a className="inline-flex h-10 items-center gap-2 rounded-md bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800" href="/artifacts/new">
          <FilePlus2 aria-hidden="true" className="size-4" />
          New artifact
        </a>
      </div>

      {error ? <Alert className="border-red-200 bg-red-50 text-red-700">{error}</Alert> : null}
      {artifacts === null && !error ? <p className="text-sm text-neutral-500">Loading artifacts...</p> : null}
      {artifacts?.length === 0 ? (
        <div className="border-t border-neutral-200 py-14 text-center">
          <p className="font-medium text-neutral-900">No artifacts yet</p>
        </div>
      ) : null}
      {artifacts && artifacts.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
          <ul className="divide-y divide-neutral-200">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <a aria-label={artifact.name} className="flex min-h-20 items-center gap-4 px-4 py-3 hover:bg-neutral-50 sm:px-5" href={`/artifacts/${encodeURIComponent(artifact.id)}`}>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-neutral-950">{artifact.name}</span>
                    <span className="mt-1 block truncate font-mono text-xs text-neutral-500">{artifact.id}</span>
                  </div>
                  <ArtifactStatus artifact={artifact} />
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-neutral-400" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
