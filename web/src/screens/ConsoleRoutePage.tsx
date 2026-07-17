import type { User } from "../api/account";
import { ConsoleShell } from "../components/ConsoleShell";
import { destinations, type ConsoleRoute } from "../routing";
import { ArtifactPage } from "./ArtifactPage";
import { ArtifactsPage } from "./ArtifactsPage";
import { GalleryProfilePage } from "./GalleryProfilePage";

export function ConsoleRoutePage({ route, user, signingOut, onSignOut, onSessionExpired }: { route: Exclude<ConsoleRoute, { kind: "console-preview" }>; user: User; signingOut: boolean; onSignOut: () => void; onSessionExpired: () => void }) {
  return (
    <ConsoleShell user={user} signingOut={signingOut} onSignOut={onSignOut}>
      {route.kind === "console-gallery-profile" ? (
        <GalleryProfilePage />
      ) : route.kind === "console-artifact" ? (
        <ArtifactPage artifactId={route.artifactId} creatorDisplayName={user.name} onSessionExpired={onSessionExpired} />
      ) : (
        <ArtifactsPage creatorDisplayName={user.name} onAccepted={() => window.location.assign(destinations.console())} />
      )}
    </ConsoleShell>
  );
}
