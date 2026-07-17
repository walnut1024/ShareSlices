import type { ReactNode } from "react";
import type { User } from "../api/account";
import { destinations } from "../routing";
import { AccountMenu } from "./AccountMenu";
import { buttonVariants } from "./ui/button";
import { Toaster } from "./ui/sonner";

export function AdministrationShell({ user, signingOut, onSignOut, children }: { user: User; signingOut: boolean; onSignOut: () => void; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="h-[57px] border-b bg-background">
        <div className="flex h-full items-center gap-[18px] px-[22px]">
          <a className="text-sm font-semibold" href={destinations.website()}>ShareSlices</a>
          <nav aria-label="Administration" className="flex flex-1 items-center gap-1">
            <a aria-current="page" className={buttonVariants({ variant: "secondary" })} href={destinations.administration()}>Gallery administration</a>
            <a className={buttonVariants({ variant: "ghost" })} href={destinations.website()}>Website</a>
          </nav>
          <AccountMenu user={user} signingOut={signingOut} onSignOut={onSignOut} />
        </div>
      </header>
      <main className="w-full px-8 py-7">{children}</main>
      <Toaster />
    </div>
  );
}
