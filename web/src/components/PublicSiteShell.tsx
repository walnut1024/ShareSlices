import { LogIn } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import type { User } from "../api/account";
import { destinations } from "../routing";
import { cn } from "../lib/utils";
import { AccountMenu } from "./AccountMenu";
import { buttonVariants } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Toaster } from "./ui/sonner";

type PublicSiteSession = {
  user: User | null;
  checking: boolean;
  signingOut: boolean;
  onSignOut: () => void;
};

const PublicSiteSessionContext = createContext<PublicSiteSession>({
  user: null,
  checking: false,
  signingOut: false,
  onSignOut: () => undefined,
});

export function PublicSiteSessionProvider({
  value,
  children,
}: {
  value: PublicSiteSession;
  children: ReactNode;
}) {
  return (
    <PublicSiteSessionContext.Provider value={value}>
      {children}
    </PublicSiteSessionContext.Provider>
  );
}

export function usePublicSiteSession() {
  return useContext(PublicSiteSessionContext);
}

export function PublicSiteShell({
  children,
  galleryAvailable = true,
}: {
  children: ReactNode;
  galleryAvailable?: boolean;
}) {
  const { user, checking, signingOut, onSignOut } = usePublicSiteSession();
  const path = window.location.pathname;
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        className="fixed top-2 left-2 z-[60] -translate-y-16 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 h-[64px] border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1200px] items-center gap-7 px-6">
          <a
            aria-label="ShareSlices home"
            className="flex shrink-0 items-center gap-2.5"
            href={destinations.website()}
          >
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">
              ShareSlices
            </span>
          </a>
          <nav className="flex min-w-0 flex-1 items-center gap-1" aria-label="Website">
            <a
              aria-current={path === "/" ? "page" : undefined}
              className={buttonVariants({ variant: path === "/" ? "secondary" : "ghost" })}
              href={destinations.website()}
            >
              Home
            </a>
            {galleryAvailable ? (
              <a
                aria-current={path === "/browse" ? "page" : undefined}
                className={buttonVariants({ variant: path === "/browse" ? "secondary" : "ghost" })}
                href={destinations.browse()}
              >
                Browse
              </a>
            ) : null}
          </nav>
          {checking ? (
            <Skeleton aria-hidden="true" className="h-[38px] w-28 rounded-full" data-testid="public-account-placeholder" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <a className={buttonVariants({ variant: "outline" })} href={destinations.console()}>
                My Artifacts
              </a>
              <AccountMenu user={user} signingOut={signingOut} onSignOut={onSignOut} />
            </div>
          ) : (
            <a className={buttonVariants({ variant: "outline" })} href={destinations.signIn()}>
              <LogIn aria-hidden="true" data-icon="inline-start" />
              Sign in
            </a>
          )}
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="border-t bg-background" role="contentinfo">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-8 px-6 py-8">
          <a aria-label="ShareSlices home" className="flex items-center gap-2.5" href={destinations.website()}>
            <BrandMark className="size-7" />
            <span className="text-sm font-semibold tracking-[-0.02em]">ShareSlices</span>
          </a>
          <nav aria-label="Footer" className="flex items-center gap-1 text-sm text-muted-foreground">
            <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={destinations.website()}>Home</a>
            {galleryAvailable ? (
              <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={destinations.browse()}>Browse</a>
            ) : null}
            <a
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={user ? destinations.console() : destinations.signIn()}
            >
              {user ? "My Artifacts" : "Sign in"}
            </a>
          </nav>
        </div>
      </footer>
      <Toaster />
    </div>
  );
}

function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex rotate-[-3deg] flex-col items-center justify-center gap-0.5 rounded-lg bg-foreground shadow-sm", className)}
    >
      <span className="h-0.5 w-4 rounded-[1px] bg-background" />
      <span className="h-0.5 w-4 rounded-[1px] bg-background/55" />
      <span className="h-0.5 w-4 rounded-[1px] bg-background/30" />
    </span>
  );
}

export function UnsupportedPublicDevice() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <div className="max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">Desktop required</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          ShareSlices needs a larger canvas.
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Open ShareSlices on a desktop window at least 1280 pixels wide to browse and play shared Artifacts safely.
        </p>
      </div>
    </main>
  );
}

export function useUnsupportedPublicDevice(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 1279px)").matches
  );
}
