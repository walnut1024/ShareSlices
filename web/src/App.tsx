import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AccountApiError, deleteCurrentSession, getCurrentUser, type User } from "./api/account";
import { ManagementShell } from "./components/ManagementShell";
import { Spinner } from "./components/ui/spinner";
import { ArtifactDetailScreen } from "./screens/ArtifactDetailScreen";
import { ArtifactListScreen } from "./screens/ArtifactListScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { RegisterScreen } from "./screens/RegisterScreen";

function accountView(): "register" | "login" {
  return new URLSearchParams(window.location.search).get("view") === "login" ? "login" : "register";
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
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(window.location.pathname.startsWith("/artifacts"));
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const onSessionExpired = useCallback(() => navigate("/?view=login"), []);
  const onSignedIn = useCallback((signedInUser: User) => {
    setUser(signedInUser);
    navigate("/artifacts");
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
      if (error instanceof AccountApiError && error.code === "unauthenticated") {
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
    const onLocationChange = () => setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  useEffect(() => {
    if (location === "/artifacts/new") navigate("/artifacts");
  }, [location]);

  const managementRoute = location.startsWith("/artifacts");
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

  if (!managementRoute) {
    const view = accountView();
    return view === "register" ? <RegisterScreen /> : <LoginScreen onSignedIn={onSignedIn} />;
  }

  if (checkingSession) {
    return <main className="flex min-h-screen items-center justify-center gap-2 bg-neutral-50 text-sm text-muted-foreground"><Spinner />Checking session...</main>;
  }
  if (!user) {
    return <LoginScreen onSignedIn={onSignedIn} />;
  }

  const detailMatch = window.location.pathname.match(/^\/artifacts\/([^/]+)$/);
  const detailArtifactId = detailMatch?.[1] === "new" ? null : detailMatch?.[1];
  return (
    <ManagementShell user={user} signingOut={signingOut} onSignOut={onSignOut}>
      {detailArtifactId ? (
        <ArtifactDetailScreen
          artifactId={decodeURIComponent(detailArtifactId)}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <ArtifactListScreen onAccepted={(artifactId) => navigate(`/artifacts/${encodeURIComponent(artifactId)}`)} />
      )}
    </ManagementShell>
  );
}
