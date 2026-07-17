import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AccountApiError,
  deleteCurrentSession,
  getCurrentUser,
  type User,
} from "./api/account";
import { ManagementShell } from "./components/ManagementShell";
import { PublicGallerySessionProvider } from "./components/PublicGalleryShell";
import { Spinner } from "./components/ui/spinner";
import { setDocumentMetadata } from "./document-metadata";
import {
  classifyRoute,
  isAccountRoute,
  isManagementRoute,
  isPublicRoute,
  validateReturnTo,
  type AppRoute,
} from "./routing";
import { ArtifactPage } from "./screens/ArtifactPage";
import { ArtifactPreviewPage } from "./screens/ArtifactPreviewPage";
import { ArtifactsPage } from "./screens/ArtifactsPage";
import { CreatorPage } from "./screens/CreatorPage";
import { DeviceAuthorizationPage } from "./screens/DeviceAuthorizationPage";
import { GalleryAdministrationPage } from "./screens/GalleryAdministrationPage";
import { GalleryListingPage } from "./screens/GalleryListingPage";
import { GalleryPage } from "./screens/GalleryPage";
import { GalleryProfilePage } from "./screens/GalleryProfilePage";
import { LoginPage } from "./screens/LoginPage";
import { NotFoundPage } from "./screens/NotFoundPage";
import { PasswordResetPage } from "./screens/PasswordResetPage";
import { SignUpPage } from "./screens/SignUpPage";

function currentLocation() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function replaceLocation(path: string) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function signInLocation(returnTo: string) {
  return `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

export default function App() {
  const initialRoute = classifyRoute(window.location.pathname);
  const [location, setLocation] = useState(currentLocation);
  const [user, setUser] = useState<User | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [checkingSession, setCheckingSession] = useState(
    isPublicRoute(initialRoute) ||
      isAccountRoute(initialRoute) ||
      isManagementRoute(initialRoute),
  );
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const route = useMemo(
    () =>
      classifyRoute(new URL(location, window.location.origin).pathname),
    [location],
  );
  const needsSession =
    isPublicRoute(route) || isAccountRoute(route) || isManagementRoute(route);

  const onSessionExpired = useCallback(() => {
    const returnTo = currentLocation();
    setUser(null);
    setSessionResolved(true);
    replaceLocation(signInLocation(returnTo));
  }, []);

  const onSignedIn = useCallback((signedInUser: User) => {
    setUser(signedInUser);
    setSessionResolved(true);
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    navigate(validateReturnTo(requested) ?? "/artifacts");
  }, []);

  const onSignOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    const remainOnPublicRoute = isPublicRoute(
      classifyRoute(window.location.pathname),
    );

    try {
      await deleteCurrentSession();
      setUser(null);
      setSessionResolved(true);
      if (!remainOnPublicRoute) replaceLocation("/");
    } catch (error) {
      if (
        error instanceof AccountApiError &&
        error.code === "unauthenticated"
      ) {
        setUser(null);
        setSessionResolved(true);
        if (!remainOnPublicRoute) replaceLocation("/");
      } else {
        toast.error("Could not sign out. Try again.");
      }
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }, []);

  useEffect(() => {
    const onLocationChange = () => setLocation(currentLocation());
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/artifacts/new") navigate("/artifacts");
  }, [location]);

  useEffect(() => {
    if (!needsSession || sessionResolved) return;
    let active = true;
    setCheckingSession(true);
    getCurrentUser()
      .then((value) => {
        if (!active) return;
        setUser(value);
        setSessionResolved(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setSessionResolved(true);
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [needsSession, sessionResolved]);

  useEffect(() => {
    if (!sessionResolved || checkingSession) return;
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    if (isAccountRoute(route) && user) {
      replaceLocation(validateReturnTo(requested) ?? "/artifacts");
      return;
    }
    if (isManagementRoute(route) && !user) {
      replaceLocation(signInLocation(currentLocation()));
    }
  }, [checkingSession, location, route, sessionResolved, user]);

  useEffect(() => {
    setRouteMetadata(route);
  }, [location, route]);

  if (route.kind === "device-authorization") {
    return <DeviceAuthorizationPage />;
  }

  if (isPublicRoute(route)) {
    const page =
      route.kind === "gallery-index" ? (
        <GalleryPage />
      ) : route.kind === "gallery-listing" ? (
        <GalleryListingPage slug={route.slug} />
      ) : (
        <CreatorPage slug={route.slug} />
      );
    return (
      <PublicGallerySessionProvider
        value={{
          user,
          checking: checkingSession,
          signingOut,
          onSignOut,
        }}
      >
        {page}
      </PublicGallerySessionProvider>
    );
  }

  if (isAccountRoute(route)) {
    if (checkingSession || (sessionResolved && user)) return <SessionCheck />;
    if (route.kind === "reset-password") return <PasswordResetPage />;
    if (route.kind === "sign-up") return <SignUpPage />;
    return <LoginPage onSignedIn={onSignedIn} />;
  }

  if (isManagementRoute(route)) {
    if (checkingSession || !sessionResolved || !user) return <SessionCheck />;

    if (route.kind === "artifact-preview") {
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

    return (
      <ManagementShell
        user={user}
        signingOut={signingOut}
        onSignOut={onSignOut}
      >
        {route.kind === "gallery-administration" ? (
          <GalleryAdministrationPage />
        ) : route.kind === "gallery-profile" ? (
          <GalleryProfilePage />
        ) : route.kind === "artifact" ? (
          <ArtifactPage
            artifactId={route.artifactId}
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

  return <NotFoundPage />;
}

function SessionCheck() {
  return (
    <main className="flex min-h-screen items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground">
      <Spinner />
      Checking session…
    </main>
  );
}

function setRouteMetadata(route: AppRoute) {
  if (route.kind === "gallery-index") {
    setDocumentMetadata({
      title: "Gallery · ShareSlices",
      robots: "index,follow",
      canonicalPath: "/",
    });
    return;
  }

  const title =
    route.kind === "sign-in"
      ? "Sign in · ShareSlices"
      : route.kind === "sign-up"
        ? "Sign up · ShareSlices"
        : route.kind === "reset-password"
          ? "Reset password · ShareSlices"
          : route.kind === "not-found"
            ? "Page not found · ShareSlices"
            : route.kind === "gallery-listing"
              ? "Gallery Artifact · ShareSlices"
              : route.kind === "creator"
                ? "Gallery Creator · ShareSlices"
                : "ShareSlices";
  setDocumentMetadata({ title, robots: "noindex,nofollow" });
}
