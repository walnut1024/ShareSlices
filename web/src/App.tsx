import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccountApiError, deleteCurrentSession, getCurrentUser, type User } from "./api/account";
import { PublicSiteSessionProvider } from "./components/PublicSiteShell";
import { Spinner } from "./components/ui/spinner";
import { documentMetadataController } from "./document-metadata";
import { classifyRoute, destinations, isAccountRoute, isProtectedRoute, isPublicRoute, validateReturnTo, type AppRoute } from "./routing";

const HomePage = lazy(() => import("./screens/HomePage").then((module) => ({ default: module.HomePage })));
const BrowsePage = lazy(() => import("./screens/BrowsePage").then((module) => ({ default: module.BrowsePage })));
const GalleryListingPage = lazy(() => import("./screens/GalleryListingPage").then((module) => ({ default: module.GalleryListingPage })));
const CreatorPage = lazy(() => import("./screens/CreatorPage").then((module) => ({ default: module.CreatorPage })));
const LoginPage = lazy(() => import("./screens/LoginPage").then((module) => ({ default: module.LoginPage })));
const SignUpPage = lazy(() => import("./screens/SignUpPage").then((module) => ({ default: module.SignUpPage })));
const PasswordResetPage = lazy(() => import("./screens/PasswordResetPage").then((module) => ({ default: module.PasswordResetPage })));
const DeviceAuthorizationPage = lazy(() => import("./screens/DeviceAuthorizationPage").then((module) => ({ default: module.DeviceAuthorizationPage })));
const ConsoleRoutePage = lazy(() => import("./screens/ConsoleRoutePage").then((module) => ({ default: module.ConsoleRoutePage })));
const ArtifactPreviewPage = lazy(() => import("./screens/ArtifactPreviewPage").then((module) => ({ default: module.ArtifactPreviewPage })));
const AdministrationRoutePage = lazy(() => import("./screens/AdministrationRoutePage").then((module) => ({ default: module.AdministrationRoutePage })));
const NotFoundPage = lazy(() => import("./screens/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));

function currentLocation() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function commitLocation(path: string, replace = false) {
  documentMetadataController.begin(classifyRoute(new URL(path, window.location.origin).pathname));
  window.history[replace ? "replaceState" : "pushState"](null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const initialRoute = classifyRoute(window.location.pathname);
  const [location, setLocation] = useState(currentLocation);
  const [user, setUser] = useState<User | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [checkingSession, setCheckingSession] = useState(isPublicRoute(initialRoute) || isAccountRoute(initialRoute) || isProtectedRoute(initialRoute));
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const authenticatedNavigationRef = useRef(false);
  const route = useMemo(() => classifyRoute(new URL(location, window.location.origin).pathname), [location]);
  const needsSession = isPublicRoute(route) || isAccountRoute(route) || isProtectedRoute(route);

  const onSessionExpired = useCallback(() => {
    setUser(null);
    setSessionResolved(true);
    commitLocation(destinations.signIn(currentLocation()), true);
  }, []);

  const onSignedIn = useCallback((signedInUser: User) => {
    authenticatedNavigationRef.current = true;
    setUser(signedInUser);
    setSessionResolved(true);
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    commitLocation(validateReturnTo(requested) ?? destinations.console());
  }, []);

  const onSignOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    const remainOnPublicRoute = isPublicRoute(classifyRoute(window.location.pathname));
    try {
      await deleteCurrentSession();
      setUser(null);
      setSessionResolved(true);
      if (!remainOnPublicRoute) commitLocation(destinations.website(), true);
    } catch (error) {
      if (error instanceof AccountApiError && error.code === "unauthenticated") {
        setUser(null);
        setSessionResolved(true);
        if (!remainOnPublicRoute) commitLocation(destinations.website(), true);
      } else {
        toast.error("Could not sign out. Try again.");
      }
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }, []);

  useEffect(() => {
    const onLocationChange = () => {
      const next = currentLocation();
      documentMetadataController.begin(classifyRoute(window.location.pathname));
      setLocation(next);
    };
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  useLayoutEffect(() => {
    documentMetadataController.begin(route);
  }, [route]);

  useEffect(() => {
    if (!needsSession || sessionResolved) return;
    let active = true;
    setCheckingSession(true);
    getCurrentUser()
      .then((value) => { if (active) { setUser(value); setSessionResolved(true); } })
      .catch(() => { if (active) { setUser(null); setSessionResolved(true); } })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [needsSession, sessionResolved]);

  useEffect(() => {
    if (!sessionResolved || checkingSession) return;
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    if (isAccountRoute(route) && user) {
      commitLocation(validateReturnTo(requested) ?? destinations.console(), true);
      return;
    }
    if (user) authenticatedNavigationRef.current = false;
    if (isProtectedRoute(route) && !user && !authenticatedNavigationRef.current) {
      commitLocation(destinations.signIn(currentLocation()), true);
    }
  }, [checkingSession, location, route, sessionResolved, user]);

  return (
    <Suspense fallback={<SessionCheck label="Loading…" />}>
      <RouteContent route={route} user={user} checkingSession={checkingSession} sessionResolved={sessionResolved} signingOut={signingOut} onSignOut={onSignOut} onSignedIn={onSignedIn} onSessionExpired={onSessionExpired} />
    </Suspense>
  );
}

function RouteContent({ route, user, checkingSession, sessionResolved, signingOut, onSignOut, onSignedIn, onSessionExpired }: { route: AppRoute; user: User | null; checkingSession: boolean; sessionResolved: boolean; signingOut: boolean; onSignOut: () => void; onSignedIn: (user: User) => void; onSessionExpired: () => void }) {
  if (route.kind === "device-authorization") return <DeviceAuthorizationPage />;

  if (isPublicRoute(route)) {
    const page = route.kind === "website-home" ? <HomePage /> : route.kind === "browse" ? <BrowsePage /> : route.kind === "gallery-listing" ? <GalleryListingPage slug={route.slug} /> : <CreatorPage slug={route.slug} />;
    return <PublicSiteSessionProvider value={{ user, checking: checkingSession, signingOut, onSignOut }}>{page}</PublicSiteSessionProvider>;
  }

  if (isAccountRoute(route)) {
    if (checkingSession || (sessionResolved && user)) return <SessionCheck />;
    if (route.kind === "reset-password") return <PasswordResetPage />;
    if (route.kind === "sign-up") return <SignUpPage />;
    return <LoginPage onSignedIn={onSignedIn} />;
  }

  if (isProtectedRoute(route)) {
    if (checkingSession || !sessionResolved || !user) return <SessionCheck />;
    if (route.kind === "gallery-administration") return <AdministrationRoutePage user={user} signingOut={signingOut} onSignOut={onSignOut} />;
    if (route.kind === "console-preview") {
      const versionId = new URLSearchParams(window.location.search).get("versionId");
      return versionId ? <ArtifactPreviewPage versionId={versionId} /> : <main className="flex min-h-screen items-center justify-center bg-foreground text-sm text-background">Preview Version is missing.</main>;
    }
    return <ConsoleRoutePage route={route} user={user} signingOut={signingOut} onSignOut={onSignOut} onSessionExpired={onSessionExpired} />;
  }

  return <NotFoundPage />;
}

function SessionCheck({ label = "Checking session…" }: { label?: string }) {
  return <main className="flex min-h-screen items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground"><Spinner />{label}</main>;
}
