import { useCallback, useEffect, useState } from "react";
import { AccountApiError, getCurrentUser, type User } from "../api/account";
import {
  approveCliAuthorization,
  denyCliAuthorization,
  getCliAuthorization
} from "../api/cli-auth";
import { Button } from "../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Spinner } from "../components/ui/spinner";
import { LoginForm } from "../components/LoginForm";
import { cn } from "../lib/utils";

function Brand() {
  return (
    <div className="flex items-center gap-2.5" aria-label="ShareSlices">
      <div className="flex flex-col gap-[3px]" aria-hidden="true">
        <span className="h-1 w-5 rounded-[1px] bg-foreground" />
        <span className="h-1 w-5 rounded-[1px] bg-foreground/50" />
        <span className="h-1 w-5 rounded-[1px] bg-foreground/20" />
      </div>
      <span className="text-base font-semibold tracking-[-0.01em]">ShareSlices</span>
    </div>
  );
}

function Shell({ children, width = "w-[480px]" }: { children: React.ReactNode; width?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-8 py-8">
      <Card className={cn(width, "rounded-2xl py-0 shadow-sm")}>
        <CardContent className="flex flex-col px-11 py-10">{children}</CardContent>
      </Card>
    </main>
  );
}

function Code({ value }: { value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="font-mono text-[11px] uppercase tracking-[0.08em]">Verification code</CardDescription>
        <CardTitle className="font-mono text-[26px] tracking-[0.28em]">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function DeviceAuthorizationPage() {
  const rawUserCode = new URLSearchParams(window.location.search).get("user_code")?.trim() ?? "";
  const cleanUserCode = rawUserCode.replaceAll("-", "");
  const userCode = cleanUserCode.length === 8
    ? `${cleanUserCode.slice(0, 4)}-${cleanUserCode.slice(4)}`
    : rawUserCode;
  const [user, setUser] = useState<User | null>(null);
  const [phase, setPhase] = useState<"checking" | "login" | "review" | "approved" | "denied" | "invalid" | "expired" | "claimed" | "error">("checking");
  const [message, setMessage] = useState<string | null>(null);

  function showAuthorizationError(error: unknown) {
    if (error instanceof AccountApiError) {
      if (error.code === "expired_token") return setPhase("expired");
      if (error.code === "access_denied") return setPhase("claimed");
      if (error.code === "invalid_grant" || error.code === "not_found") return setPhase("invalid");
    }
    setMessage(error instanceof Error ? error.message : "Authorization is no longer valid.");
    setPhase("error");
  }

  const loadAuthorization = useCallback(async (currentUser: User) => {
    try {
      const authorization = await getCliAuthorization(userCode);
      setUser(currentUser);
      setPhase(authorization.status === "denied" ? "denied" : authorization.status === "approved" ? "approved" : "review");
    } catch (error) {
      showAuthorizationError(error);
    }
  }, [userCode]);

  useEffect(() => {
    if (!userCode) {
      setMessage("The verification code is missing.");
      setPhase("error");
      return;
    }
    getCurrentUser()
      .then((currentUser) => {
        if (!currentUser) setPhase("login");
        else void loadAuthorization(currentUser);
      })
      .catch(() => {
        setMessage("Could not check your session. Try again.");
        setPhase("error");
      });
  }, [loadAuthorization, userCode]);

  async function decide(action: "approve" | "deny") {
    try {
      if (action === "approve") {
        await approveCliAuthorization(userCode);
        setPhase("approved");
      } else {
        await denyCliAuthorization(userCode);
        setPhase("denied");
      }
    } catch (error) {
      showAuthorizationError(error);
    }
  }

  if (phase === "checking") {
    return <main className="flex min-h-screen items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground"><Spinner />Checking authorization...</main>;
  }

  if (phase === "approved" || phase === "denied") {
    const approved = phase === "approved";
    return (
      <Shell width="w-[420px]">
        <div className="flex flex-col items-center py-3 text-center">
          <Avatar className="size-[52px]"><AvatarFallback className="text-2xl">{approved ? "✓" : "×"}</AvatarFallback></Avatar>
          <h1 className="mb-2 mt-6 text-[23px] font-semibold tracking-[-0.02em]">
            {approved ? "CLI authorized" : "Authorization denied"}
          </h1>
          <p className="m-0 max-w-[300px] text-sm leading-6 text-muted-foreground">
            {approved ? <>A new CLI session was created for <strong className="font-medium text-foreground">{user?.email}</strong>. Return to your terminal to continue.</> : "No CLI session was created. Return to your terminal to continue."}
          </p>
          <p className="mb-0 mt-6 text-[12.5px] text-muted-foreground">You can close this window.</p>
        </div>
      </Shell>
    );
  }

  if (phase === "error") {
    return <Shell width="w-[420px]"><Brand /><Alert variant="destructive" className="mt-7"><AlertTitle><h1>Authorization unavailable</h1></AlertTitle><AlertDescription>{message}</AlertDescription></Alert></Shell>;
  }

  if (phase === "invalid" || phase === "expired" || phase === "claimed") {
    const content = {
      invalid: ["Invalid verification code", "Return to your terminal and start sign-in again."],
      expired: ["Verification code expired", "Return to your terminal and run shareslices auth login again."],
      claimed: ["Authorization unavailable", "This authorization belongs to another account. Return to your terminal and start again."]
    }[phase];
    return <Shell width="w-[420px]"><Brand /><Alert className="mt-7"><AlertTitle><h1>{content[0]}</h1></AlertTitle><AlertDescription>{content[1]}</AlertDescription></Alert></Shell>;
  }

  if (phase === "login") {
    return (
      <Shell width="w-[440px]">
        <Brand />
        <Badge className="mt-5" variant="secondary">Authorizing the ShareSlices CLI</Badge>
        <h1 className="mb-1.5 mt-[22px] text-2xl font-semibold tracking-[-0.02em]">Log in to continue</h1>
        <p className="mb-5 mt-0 text-sm text-muted-foreground">Sign in to authorize the ShareSlices command-line tool.</p>
        <Code value={userCode} />
        <p className="mb-6 mt-2 text-[12.5px] text-muted-foreground">Confirm this matches the code in your terminal before signing in.</p>
        <LoginForm buttonLabel="Continue" onSignedIn={loadAuthorization} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Brand />
      <h1 className="mb-1.5 mt-7 text-[23px] font-semibold tracking-[-0.02em]">Authorize the ShareSlices CLI?</h1>
      <p className="mb-[22px] mt-0 text-sm leading-6 text-muted-foreground">A command-line tool is asking to sign in to your account. Approve only if you started this.</p>
      <div className="mb-3.5 flex items-center gap-3 rounded-xl border px-3.5 py-3">
        <Avatar className="size-[38px]"><AvatarFallback>{user?.name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
        <div><div className="text-sm font-medium">{user?.name}</div><div className="text-[13px] text-muted-foreground">{user?.email}</div></div>
      </div>
      <div className="mb-5 flex items-center justify-between rounded-xl border bg-muted/40 px-4 py-[13px]"><span className="text-[13px] text-muted-foreground">Verification code</span><span className="font-mono text-[13.5px] font-medium tracking-[0.06em]">{userCode}</span></div>
      <div className="flex gap-2.5"><Button className="w-[130px]" variant="outline" onClick={() => void decide("deny")}>Deny</Button><Button className="flex-1" onClick={() => void decide("approve")}>Approve</Button></div>
    </Shell>
  );
}
