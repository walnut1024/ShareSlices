import { useState } from "react";
import {
  requestPasswordReset,
  resetPassword,
  verifyPasswordResetCode,
  type VerificationState
} from "../api/account";
import { AuthLayout } from "../components/AuthLayout";
import { VerificationCodeForm } from "../components/VerificationCodeForm";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";

type Stage = "request" | "code" | "password" | "complete";

export function PasswordResetPage() {
  const [stage, setStage] = useState<Stage>("request");
  const [verification, setVerification] = useState<VerificationState["verification"] | null>(null);
  const [resetGrant, setResetGrant] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (stage === "code" && verification) {
    return (
      <AuthLayout>
        <VerificationCodeForm
          destination={verification.destination}
          initialWait={verification.resendAvailableIn}
          buttonLabel="Continue"
          onVerify={async (code) => {
            const result = await verifyPasswordResetCode(verification.id, code);
            setResetGrant(result.resetGrant);
            setStage("password");
          }}
          onResend={async () => (await requestPasswordReset(email)).verification.resendAvailableIn}
          onChangeEmail={() => { setVerification(null); setStage("request"); }}
        />
      </AuthLayout>
    );
  }

  if (stage === "password" && resetGrant) {
    return (
      <AuthLayout>
        <header><h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Set a new password</h1></header>
        <form className="mt-7 flex flex-col gap-6" onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const password = String(form.get("password") ?? "");
          const confirmPassword = String(form.get("confirmPassword") ?? "");
          if (password.length < 8 || password !== confirmPassword) {
            setMessage(password.length < 8 ? "Use at least 8 characters." : "Passwords do not match.");
            return;
          }
          try {
            await resetPassword({ resetGrant, password, confirmPassword });
            setStage("complete");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Password reset failed.");
          }
        }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="new-password">New password</FieldLabel><Input id="new-password" name="password" type="password" autoComplete="new-password" /></Field>
            <Field><FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel><Input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" /></Field>
          </FieldGroup>
          {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
          <Button type="submit">Reset password</Button>
        </form>
      </AuthLayout>
    );
  }

  if (stage === "complete") {
    return (
      <AuthLayout>
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Password reset</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">Your password has been changed. Sign in with your new password.</p>
        <a className={buttonVariants({ className: "w-full" })} href="/sign-in">Sign in</a>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <header><h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Reset your password</h1><p className="mb-7 mt-1.5 text-sm text-muted-foreground">Enter your account email to receive a verification code.</p></header>
      <form className="flex flex-col gap-6" onSubmit={async (event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
        try {
          const result = await requestPasswordReset(email);
          setEmail(email);
          setVerification(result.verification);
          setStage("code");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not request password reset.");
        }
      }}>
        <Field><FieldLabel htmlFor="reset-email">Email</FieldLabel><Input id="reset-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" /></Field>
        {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
        <Button type="submit">Send verification code</Button>
      </form>
      <p className="mt-5 text-[13px]"><a className="font-medium hover:underline" href="/sign-in">Return to sign in</a></p>
    </AuthLayout>
  );
}
