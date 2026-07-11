import { useState } from "react";
import { AccountApiError, createUser } from "../api/account";
import { AuthLayout } from "../components/AuthLayout";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";

type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

export function RegisterPage() {
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
    <AuthLayout>
      <header>
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Create your account</h1>
        <p className="mb-[26px] mt-1.5 text-sm leading-[1.45] text-neutral-500">
          Free to start — no card required.
        </p>
      </header>
      <form className="flex flex-col gap-[22px]" onSubmit={onSubmit}>
        <FieldGroup className="gap-[15px]">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" autoComplete="name" placeholder="Ada Lovelace" aria-invalid={Boolean(errors.name)} />
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" aria-invalid={Boolean(errors.email)} />
            {errors.email ? <FieldError>{errors.email}</FieldError> : null}
          </Field>
          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="Create a password" aria-invalid={Boolean(errors.password)} />
            {errors.password ? <FieldError>{errors.password}</FieldError> : null}
            <div className="mt-0.5 flex items-center gap-2" aria-hidden="true">
              <div className="flex flex-1 gap-1">
                <span className="h-1 flex-1 rounded-sm bg-neutral-200" />
                <span className="h-1 flex-1 rounded-sm bg-neutral-200" />
                <span className="h-1 flex-1 rounded-sm bg-neutral-200" />
              </div>
              <span className="flex-none text-xs text-neutral-400">8+ characters</span>
            </div>
          </Field>
        </FieldGroup>
        {errors.form ? <Alert variant="destructive"><AlertDescription>{errors.form}</AlertDescription></Alert> : null}
        {createdName ? <Alert><AlertDescription>Account created for {createdName}. Log in to continue.</AlertDescription></Alert> : null}
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
      <p className="mb-0 mt-3.5 max-w-[300px] text-xs leading-normal text-neutral-400">
        By creating an account you agree to our <span className="text-neutral-500">Terms</span> and <span className="text-neutral-500">Privacy Policy</span>.
      </p>
      <p className="mb-0 mt-[18px] text-[13.5px] text-neutral-500">
        Already have an account? <a className="font-medium text-neutral-950 hover:underline" href="/?view=login">Log in</a>
      </p>
    </AuthLayout>
  );
}
