import { useState } from "react";
import { createSession } from "../api/account";
import { AuthScreenLayout } from "../components/AuthScreenLayout";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";

export function LoginScreen({ onSignedIn }: { onSignedIn?: (user: { id: string; name: string; email: string }) => void }) {
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setMessage(null);

    try {
      const result = await createSession({ email, password });
      onSignedIn?.(result.user);
    } catch {
      setMessage("Email or password is incorrect.");
    }
  }

  return (
    <AuthScreenLayout footer={<>Protected by encryption · <span className="text-neutral-500">Privacy Policy</span></>}>
      <header>
        <h1 aria-label="Log in" className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="mb-7 mt-1.5 text-sm leading-[1.45] text-neutral-500">
          Log in to manage and publish your artifacts.
        </p>
      </header>
      <form className="flex flex-col gap-6" onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="••••••••••" />
          </Field>
        </FieldGroup>
        {message ? <Alert><AlertDescription>{message}</AlertDescription></Alert> : null}
        <Button type="submit" className="w-full">
          Log in
        </Button>
      </form>
      <p className="mb-0 mt-[22px] text-[13.5px] text-neutral-500">
        New to ShareSlices? <a className="font-medium text-neutral-950 hover:underline" href="/?view=register">Create an account</a>
      </p>
    </AuthScreenLayout>
  );
}
