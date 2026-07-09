import { useState } from "react";
import { AccountApiError, createUser } from "../api/account";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

export function RegisterScreen() {
  const [errors, setErrors] = useState<Errors>({});
  const [createdName, setCreatedName] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const nextErrors: Errors = {};

    if (!name) {
      nextErrors.name = "Enter a name.";
    }
    if (!email.includes("@")) {
      nextErrors.email = "Enter a valid email.";
    }
    if (password.length < 8) {
      nextErrors.password = "Use at least 8 characters.";
    }

    setErrors(nextErrors);
    setCreatedName(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      const user = await createUser({ name, email, password });
      setCreatedName(user.name);
    } catch (error) {
      if (error instanceof AccountApiError && error.fields.length > 0) {
        const fieldErrors: Errors = {};
        for (const field of error.fields) {
          if (field.path === "name" || field.path === "email" || field.path === "password") {
            fieldErrors[field.path] = field.message;
          }
        }
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
          return;
        }
      }
      setErrors({ form: error instanceof Error ? error.message : "Registration failed." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Use your name, email, and password to start.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" />
            {errors.name ? <p className="text-sm text-red-600">{errors.name}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" />
            {errors.email ? <p className="text-sm text-red-600">{errors.email}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" />
            {errors.password ? <p className="text-sm text-red-600">{errors.password}</p> : null}
          </div>
          {errors.form ? <Alert>{errors.form}</Alert> : null}
          {createdName ? <Alert>Account created for {createdName}. Log in to continue.</Alert> : null}
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
