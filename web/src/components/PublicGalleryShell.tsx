import { LogIn } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import type { User } from "../api/account";
import { AccountMenu } from "./AccountMenu";
import { buttonVariants } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Toaster } from "./ui/sonner";

type PublicGallerySession = {
  user: User | null;
  checking: boolean;
  signingOut: boolean;
  onSignOut: () => void;
};

const PublicGallerySessionContext = createContext<PublicGallerySession>({
  user: null,
  checking: false,
  signingOut: false,
  onSignOut: () => undefined,
});

export function PublicGallerySessionProvider({
  value,
  children,
}: {
  value: PublicGallerySession;
  children: ReactNode;
}) {
  return (
    <PublicGallerySessionContext.Provider value={value}>
      {children}
    </PublicGallerySessionContext.Provider>
  );
}

export function usePublicGallerySession() {
  return useContext(PublicGallerySessionContext);
}

export function PublicGalleryShell({ children }: { children: ReactNode }) {
  const { user, checking, signingOut, onSignOut } = usePublicGallerySession();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-[57px] border-b bg-background">
        <div className="flex h-full items-center gap-[18px] px-[22px]">
          <a
            aria-label="ShareSlices artifacts"
            className="flex shrink-0 items-center gap-[9px]"
            href="/"
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
            className="ml-2 flex min-w-0 flex-1 items-center gap-0.5"
            aria-label="Gallery"
          >
            <a
              aria-current="page"
              className={buttonVariants({ variant: "secondary" })}
              href="/"
            >
              Gallery
            </a>
          </nav>
          {checking ? (
            <Skeleton aria-hidden="true" className="h-[38px] w-28 rounded-full" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <a
                className={buttonVariants({ variant: "outline" })}
                href="/artifacts"
              >
                My Artifacts
              </a>
              <AccountMenu
                user={user}
                signingOut={signingOut}
                onSignOut={onSignOut}
              />
            </div>
          ) : (
            <a
              className={buttonVariants({ variant: "outline" })}
              href="/sign-in"
            >
              <LogIn aria-hidden="true" data-icon="inline-start" />
              Sign in
            </a>
          )}
        </div>
      </header>
      {children}
      <Toaster />
    </div>
  );
}

export function UnsupportedGalleryDevice() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <div className="max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">
          Desktop required
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Gallery is made for a larger canvas.
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Open ShareSlices Gallery on a desktop window at least 1280 pixels wide
          to browse and play shared Artifacts safely.
        </p>
      </div>
    </main>
  );
}

export function useUnsupportedGalleryDevice(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 1279px)").matches
  );
}
