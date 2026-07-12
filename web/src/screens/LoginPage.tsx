import { AuthLayout } from "../components/AuthLayout";
import { LoginForm } from "../components/LoginForm";
import { useState } from "react";
import { resendSignUpEmail, verifySignUpEmail, type VerificationState } from "../api/account";
import { VerificationCodeForm } from "../components/VerificationCodeForm";

export function LoginPage({ onSignedIn }: { onSignedIn?: (user: { id: string; name: string; email: string }) => void }) {
  const [verification, setVerification] = useState<VerificationState["verification"] | null>(null);
  const [verified, setVerified] = useState(false);

  if (verification) {
    return (
      <AuthLayout>
        {verified ? (
          <>
            <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Email verified</h1>
            <p className="mb-6 mt-2 text-sm text-neutral-500">Log in again to continue.</p>
            <button className="text-sm font-medium hover:underline" onClick={() => { setVerification(null); setVerified(false); }}>Return to login</button>
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
    <AuthLayout footer={<>Protected by encryption · <span className="text-neutral-500">Privacy Policy</span></>}>
      <header>
        <h1 aria-label="Log in" className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="mb-7 mt-1.5 text-sm leading-[1.45] text-neutral-500">
          Log in to manage and publish your artifacts.
        </p>
      </header>
      <LoginForm onSignedIn={onSignedIn} onVerificationRequired={setVerification} />
      <p className="mb-0 mt-4 text-right text-[13px]"><a className="font-medium text-neutral-950 hover:underline" href="/?view=reset">Forgot password?</a></p>
      <p className="mb-0 mt-[22px] text-[13.5px] text-neutral-500">
        New to ShareSlices? <a className="font-medium text-neutral-950 hover:underline" href="/?view=signup">Sign up</a>
      </p>
    </AuthLayout>
  );
}
