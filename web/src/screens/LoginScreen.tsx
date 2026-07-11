import { AuthScreenLayout } from "../components/AuthScreenLayout";
import { LoginForm } from "../components/LoginForm";

export function LoginScreen({ onSignedIn }: { onSignedIn?: (user: { id: string; name: string; email: string }) => void }) {
  return (
    <AuthScreenLayout footer={<>Protected by encryption · <span className="text-neutral-500">Privacy Policy</span></>}>
      <header>
        <h1 aria-label="Log in" className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="mb-7 mt-1.5 text-sm leading-[1.45] text-neutral-500">
          Log in to manage and publish your artifacts.
        </p>
      </header>
      <LoginForm onSignedIn={onSignedIn} />
      <p className="mb-0 mt-[22px] text-[13.5px] text-neutral-500">
        New to ShareSlices? <a className="font-medium text-neutral-950 hover:underline" href="/?view=register">Create an account</a>
      </p>
    </AuthScreenLayout>
  );
}
