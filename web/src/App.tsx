import { useCallback, useEffect, useState } from "react";
import { getCurrentUser, type User } from "./api/account";
import { ManagementShell } from "./components/ManagementShell";
import { ArtifactDetailScreen } from "./screens/ArtifactDetailScreen";
import { ArtifactListScreen } from "./screens/ArtifactListScreen";
import { CreateArtifactScreen } from "./screens/CreateArtifactScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { RegisterScreen } from "./screens/RegisterScreen";

function accountView(): "register" | "login" {
  return new URLSearchParams(window.location.search).get("view") === "login" ? "login" : "register";
}

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(window.location.pathname.startsWith("/artifacts"));
  const onSessionExpired = useCallback(() => navigate("/?view=login"), []);

  useEffect(() => {
    const onLocationChange = () => setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

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
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
        <div className="w-full max-w-[420px]">
          {view === "register" ? (
            <RegisterScreen />
          ) : (
            <LoginScreen onSignedIn={setUser} />
          )}
          <nav className="mt-4 flex justify-center text-sm text-neutral-500">
            {view === "register" ? <a href="/?view=login">Log in instead</a> : <a href="/?view=register">Create an account</a>}
          </nav>
        </div>
      </main>
    );
  }

  if (checkingSession) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-500">Checking session...</main>;
  }
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
        <div className="w-full max-w-[420px]">
          <LoginScreen onSignedIn={(signedInUser) => setUser(signedInUser)} />
          <nav className="mt-4 flex justify-center text-sm text-neutral-500"><a href="/?view=register">Create an account</a></nav>
        </div>
      </main>
    );
  }

  const detailMatch = window.location.pathname.match(/^\/artifacts\/([^/]+)$/);
  return (
    <ManagementShell user={user}>
      {window.location.pathname === "/artifacts/new" ? (
        <CreateArtifactScreen onAccepted={(artifactId) => navigate(`/artifacts/${encodeURIComponent(artifactId)}`)} />
      ) : detailMatch ? (
        <ArtifactDetailScreen
          artifactId={decodeURIComponent(detailMatch[1]!)}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <ArtifactListScreen />
      )}
    </ManagementShell>
  );
}
