import type { ReactNode } from "react";
import type { User } from "../api/account";
import { AccountMenu } from "./AccountMenu";
import { buttonVariants } from "./ui/button";
import { Toaster } from "./ui/sonner";
import { GalleryShareFeedbackProvider } from "./GalleryShareFeedback";

export function ManagementShell({
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
          <a
            aria-label="ShareSlices artifacts"
            className="flex shrink-0 items-center gap-[9px]"
            href="/artifacts"
          >
            <span
              aria-hidden="true"
              className="flex size-7 flex-col items-center justify-center gap-0.5 rounded-lg bg-foreground"
            >
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background" />
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background/55" />
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background/30" />
            </span>
            <span className="text-[14.5px] font-semibold tracking-[-0.01em]">
              ShareSlices
            </span>
          </a>
          <nav
            aria-label="Management"
            className="ml-2 flex min-w-0 flex-1 items-center gap-0.5"
          >
            <a
              aria-current="page"
              className={buttonVariants({ variant: "secondary" })}
              href="/artifacts"
            >
              Artifacts
            </a>
            <a className={buttonVariants({ variant: "ghost" })} href="/">
              Gallery
            </a>
          </nav>
          <div className="flex items-center">
            <AccountMenu
              user={user}
              signingOut={signingOut}
              onSignOut={onSignOut}
            />
          </div>
        </div>
      </header>
      <main className="w-full px-8 py-7">
        <GalleryShareFeedbackProvider key={user.id} userId={user.id}>
          {children}
        </GalleryShareFeedbackProvider>
      </main>
      <Toaster />
    </div>
  );
}
