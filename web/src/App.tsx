import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AccountApiError,
  deleteCurrentSession,
  getCurrentUser,
  type User,
} from "./api/account";
import { ManagementShell } from "./components/ManagementShell";
import { Spinner } from "./components/ui/spinner";
import { ArtifactPage } from "./screens/ArtifactPage";
import { ArtifactPreviewPage } from "./screens/ArtifactPreviewPage";
import { ArtifactsPage } from "./screens/ArtifactsPage";
import { DeviceAuthorizationPage } from "./screens/DeviceAuthorizationPage";
import { LoginPage } from "./screens/LoginPage";
import { SignUpPage } from "./screens/SignUpPage";
import { PasswordResetPage } from "./screens/PasswordResetPage";
import { GalleryPage } from "./screens/GalleryPage";
import { GalleryListingPage } from "./screens/GalleryListingPage";
import { CreatorPage } from "./screens/CreatorPage";
import { GalleryAdministrationPage } from "./screens/GalleryAdministrationPage";
import { GalleryProfilePage } from "./screens/GalleryProfilePage";

function accountView(): "signup" | "login" | "reset" {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "login" || view === "reset" ? view : "signup";
}

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function replaceLocation(path: string) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [location, setLocation] = useState(
    () => window.location.pathname + window.location.search,
  );
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(
    window.location.pathname.startsWith("/artifacts"),
  );
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const onSessionExpired = useCallback(() => navigate("/?view=login"), []);
  const onSignedIn = useCallback((signedInUser: User) => {
    setUser(signedInUser);
    const requested = new URLSearchParams(window.location.search).get(
      "returnTo",
    );
    navigate(
      requested?.startsWith("/") && !requested.startsWith("//")
        ? requested
        : "/artifacts",
    );
  }, []);
  const onSignOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);

    try {
      await deleteCurrentSession();
      setUser(null);
      replaceLocation("/?view=login");
    } catch (error) {
      if (
        error instanceof AccountApiError &&
        error.code === "unauthenticated"
      ) {
        setUser(null);
        replaceLocation("/?view=login");
      } else {
        toast.error("Could not sign out. Try again.");
      }
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }, []);

  useEffect(() => {
    const onLocationChange = () =>
      setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  useEffect(() => {
    if (location === "/artifacts/new") navigate("/artifacts");
  }, [location]);

  const managementRoute = location.startsWith("/artifacts") || location === "/admin/gallery" || location === "/settings/gallery-profile";
  useEffect(() => {
    if (!managementRoute || user) return;
    let active = true;
    setCheckingSession(true);
    getCurrentUser()
      .then((value) => {
        if (active) setUser(value);
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [managementRoute, user]);

  if (location.startsWith("/device")) {
    return <DeviceAuthorizationPage />;
  }

  const galleryListingMatch =
    window.location.pathname.match(/^\/gallery\/([^/]+)$/);
  if (galleryListingMatch) {
    return (
      <GalleryListingPage slug={decodeURIComponent(galleryListingMatch[1]!)} />
    );
  }
  if (window.location.pathname === "/gallery") {
    return <GalleryPage />;
  }
  const creatorMatch = window.location.pathname.match(/^\/creators\/([^/]+)$/);
  if (creatorMatch) {
    return <CreatorPage slug={decodeURIComponent(creatorMatch[1]!)} />;
  }

  if (!managementRoute) {
    const view = accountView();
    if (view === "reset") return <PasswordResetPage />;
    return view === "signup" ? (
      <SignUpPage />
    ) : (
      <LoginPage onSignedIn={onSignedIn} />
    );
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground">
        <Spinner />
        Checking session...
      </main>
    );
  }
  if (!user) {
    return <LoginPage onSignedIn={onSignedIn} />;
  }

  const previewMatch = window.location.pathname.match(
    /^\/artifacts\/[^/]+\/preview$/,
  );
  if (previewMatch) {
    const versionId = new URLSearchParams(window.location.search).get(
      "versionId",
    );
    return versionId ? (
      <ArtifactPreviewPage versionId={versionId} />
    ) : (
      <main className="flex min-h-screen items-center justify-center bg-foreground text-sm text-background">
        Preview Version is missing.
      </main>
    );
  }

  const detailMatch = window.location.pathname.match(/^\/artifacts\/([^/]+)$/);
  const detailArtifactId = detailMatch?.[1] === "new" ? null : detailMatch?.[1];
  return (
    <ManagementShell user={user} signingOut={signingOut} onSignOut={onSignOut}>
      {location === "/admin/gallery" ? <GalleryAdministrationPage /> : location === "/settings/gallery-profile" ? <GalleryProfilePage /> : detailArtifactId ? (
        <ArtifactPage
          artifactId={decodeURIComponent(detailArtifactId)}
          creatorDisplayName={user.name}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <ArtifactsPage
          creatorDisplayName={user.name}
          onAccepted={() => navigate("/artifacts")}
        />
      )}
    </ManagementShell>
  );
}
