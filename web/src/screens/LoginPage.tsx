import { AuthLayout } from "../components/AuthLayout";
import { LoginForm } from "../components/LoginForm";
import { useState } from "react";
import { resendSignUpEmail, verifySignUpEmail, type VerificationState } from "../api/account";
import { VerificationCodeForm } from "../components/VerificationCodeForm";
import { Button } from "../components/ui/button";

export function LoginPage({ onSignedIn }: { onSignedIn?: (user: { id: string; name: string; email: string }) => void }) {
  const [verification, setVerification] = useState<VerificationState["verification"] | null>(null);
  const [verified, setVerified] = useState(false);

  if (verification) {
    return (
      <AuthLayout>
        {verified ? (
          <>
            <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Email verified</h1>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">Sign in again to continue.</p>
            <Button onClick={() => { setVerification(null); setVerified(false); }}>Return to sign in</Button>
          </>
        ) : (
          <VerificationCodeForm
            destination={verification.destination}
            initialWait={verification.resendAvailableIn}
            buttonLabel="Verify email"
            onVerify={async (code) => { await verifySignUpEmail(verification.id, code); setVerified(true); }}
            onResend={async () => (await resendSignUpEmail(verification.id)).verification.resendAvailableIn}
            onChangeEmail={() => setVerification(null)}
          />
        )}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout footer={<>Protected by encryption · <span className="text-foreground">Privacy Policy</span></>}>
      <header>
        <h1 aria-label="Sign in" className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="mb-7 mt-1.5 text-sm leading-[1.45] text-muted-foreground">
          Sign in to manage and publish your artifacts.
        </p>
      </header>
      <LoginForm onSignedIn={onSignedIn} onVerificationRequired={setVerification} />
      <p className="mb-0 mt-4 text-right text-[13px]"><a className="font-medium text-foreground hover:underline" href="/reset-password">Forgot password?</a></p>
      <p className="mb-0 mt-[22px] text-[13.5px] text-muted-foreground">
        New to ShareSlices? <a className="font-medium text-foreground hover:underline" href="/sign-up">Create account</a>
      </p>
    </AuthLayout>
  );
}
