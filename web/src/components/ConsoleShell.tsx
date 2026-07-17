import type { ReactNode } from "react";
import type { User } from "../api/account";
import { destinations } from "../routing";
import { AccountMenu } from "./AccountMenu";
import { GalleryShareFeedbackProvider } from "./GalleryShareFeedback";
import { buttonVariants } from "./ui/button";
import { Toaster } from "./ui/sonner";

export function ConsoleShell({
  user,
  signingOut,
  onSignOut,
  children,
}: {
  user: User;
  signingOut: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="h-[57px] border-b bg-background">
        <div className="flex h-full items-center gap-[18px] px-[22px]">
          <a aria-label="ShareSlices Console" className="flex shrink-0 items-center gap-[9px]" href={destinations.console()}>
            <span aria-hidden="true" className="flex size-7 flex-col items-center justify-center gap-0.5 rounded-lg bg-foreground">
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background" />
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background/55" />
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background/30" />
            </span>
            <span className="text-[14.5px] font-semibold tracking-[-0.01em]">ShareSlices</span>
          </a>
          <nav aria-label="Console" className="ml-2 flex min-w-0 flex-1 items-center gap-0.5">
            <a aria-current="page" className={buttonVariants({ variant: "secondary" })} href={destinations.console()}>Artifacts</a>
            <a className={buttonVariants({ variant: "ghost" })} href={destinations.website()}>Website</a>
          </nav>
          <AccountMenu user={user} signingOut={signingOut} onSignOut={onSignOut} />
        </div>
      </header>
      <main className="w-full px-8 py-7">
        <GalleryShareFeedbackProvider key={user.id} userId={user.id}>{children}</GalleryShareFeedbackProvider>
      </main>
      <Toaster />
    </div>
  );
}
