import { useState } from "react";
import {
  AccountApiError,
  resendSignUpEmail,
  signUp,
  verifySignUpEmail,
  type VerificationState
} from "../api/account";
import { AuthLayout } from "../components/AuthLayout";
import { VerificationCodeForm } from "../components/VerificationCodeForm";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";

type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

export function SignUpPage() {
  const [errors, setErrors] = useState<Errors>({});
  const [createdName, setCreatedName] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationState["verification"] | null>(null);
  const [verified, setVerified] = useState(false);

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
      const result = await signUp({ name, email, password });
      if ("verification" in result) {
        setVerification(result.verification);
      } else {
        setCreatedName(result.user.name);
      }
    } catch (error) {
      if (error instanceof AccountApiError && error.code === "email_already_registered") {
        setErrors({ email: "This email address is already in use. Use a different email." });
        return;
      }
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
      setErrors({ form: error instanceof Error ? error.message : "Sign up failed." });
    }
  }

  if (verification) {
    return (
      <AuthLayout>
        {verified ? (
          <>
            <header><h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Email verified</h1></header>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">Your email is verified. Sign in to continue.</p>
            <a className={buttonVariants({ className: "w-full" })} href="/sign-in">Sign in</a>
          </>
        ) : (
          <VerificationCodeForm
            destination={verification.destination}
            initialWait={verification.resendAvailableIn}
            buttonLabel="Verify email"
            onVerify={async (code) => {
              await verifySignUpEmail(verification.id, code);
              setVerified(true);
            }}
            onResend={async () => (await resendSignUpEmail(verification.id)).verification.resendAvailableIn}
            onChangeEmail={() => setVerification(null)}
          />
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <header>
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Create account</h1>
        <p className="mb-[26px] mt-1.5 text-sm leading-[1.45] text-muted-foreground">
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
                <span className="h-1 flex-1 rounded-sm bg-muted" />
                <span className="h-1 flex-1 rounded-sm bg-muted" />
                <span className="h-1 flex-1 rounded-sm bg-muted" />
              </div>
              <span className="flex-none text-xs text-muted-foreground">8+ characters</span>
            </div>
          </Field>
        </FieldGroup>
        {errors.form ? <Alert variant="destructive"><AlertDescription>{errors.form}</AlertDescription></Alert> : null}
        {createdName ? <Alert><AlertDescription>You’re signed up as {createdName}. Sign in to continue.</AlertDescription></Alert> : null}
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
      <p className="mb-0 mt-3.5 max-w-[300px] text-xs leading-normal text-muted-foreground">
        By signing up you agree to our <span className="text-foreground">Terms</span> and <span className="text-foreground">Privacy Policy</span>.
      </p>
      <p className="mb-0 mt-[18px] text-[13.5px] text-muted-foreground">
        Already have an account? <a className="font-medium text-foreground hover:underline" href="/sign-in">Sign in</a>
      </p>
    </AuthLayout>
  );
}
