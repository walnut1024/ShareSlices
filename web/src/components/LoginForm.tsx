import { useState } from "react";
import { createSession, type User } from "../api/account";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export function LoginForm({
  buttonLabel = "Log in",
  onSignedIn
}: {
  buttonLabel?: string;
  onSignedIn?: ((user: User) => void | Promise<void>) | undefined;
}) {
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);

    try {
      const result = await createSession({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? "")
      });
      await onSignedIn?.(result.user);
    } catch {
      setMessage("Email or password is incorrect.");
    }
  }

  return (
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
      <Button type="submit" className="w-full">{buttonLabel}</Button>
    </form>
  );
}
