import { LoginScreen } from "./screens/LoginScreen";
import { RegisterScreen } from "./screens/RegisterScreen";

function currentView(): "register" | "login" {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "login" ? "login" : "register";
}

export default function App() {
  const view = currentView();

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-[420px]">
        {view === "register" ? <RegisterScreen /> : <LoginScreen />}
        <nav className="mt-4 flex justify-center text-sm text-neutral-500">
          {view === "register" ? <a href="/?view=login">Log in instead</a> : <a href="/?view=register">Create an account</a>}
        </nav>
      </div>
    </main>
  );
}
