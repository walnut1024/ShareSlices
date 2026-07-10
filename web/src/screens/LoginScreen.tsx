import { useState } from "react";
import { createSession } from "../api/account";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function LoginScreen({ onSignedIn }: { onSignedIn?: (user: { id: string; name: string; email: string }) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [signedInName, setSignedInName] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setMessage(null);
    setSignedInName(null);

    try {
      const result = await createSession({ email, password });
      setSignedInName(result.user.name);
      onSignedIn?.(result.user);
    } catch {
      setMessage("Email or password is incorrect.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Enter the email and password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </div>
          {message ? <Alert>{message}</Alert> : null}
          {signedInName ? (
            <Alert>
              Signed in as {signedInName}. <a className="font-medium underline" href="/artifacts">Continue to artifacts</a>
            </Alert>
          ) : null}
          <Button type="submit" className="w-full">
            Log in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
