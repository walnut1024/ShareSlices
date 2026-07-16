import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export function VerificationCodeForm({
  destination,
  initialWait,
  buttonLabel,
  onVerify,
  onResend,
  onChangeEmail
}: {
  destination: string;
  initialWait: number;
  buttonLabel: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<number>;
  onChangeEmail: () => void;
}) {
  const [remaining, setRemaining] = useState(initialWait);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replaceAll(" ", "");
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the 6-digit code.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await onVerify(code);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The verification code is invalid or expired.");
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setPending(true);
    setMessage(null);
    try {
      setRemaining(await onResend());
      setMessage("A new email has been requested.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We cannot send another code right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <header>
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Check your email</h1>
        <p className="mb-7 mt-1.5 text-sm leading-[1.45] text-muted-foreground">
          Enter the 6-digit code sent to {destination}.
        </p>
      </header>
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <Field data-invalid={Boolean(message)}>
          <FieldLabel htmlFor="verification-code">Verification code</FieldLabel>
          <Input
            id="verification-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123 456"
            aria-invalid={Boolean(message)}
          />
          {message ? <FieldError>{message}</FieldError> : null}
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>{buttonLabel}</Button>
      </form>
      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="link" size="sm" type="button" disabled={pending || remaining > 0} onClick={resend}>
          {remaining > 0 ? `Send again in ${remaining}s` : "Send another code"}
        </Button>
        <Button variant="link" size="sm" type="button" onClick={onChangeEmail}>Use a different email</Button>
      </div>
    </>
  );
}
