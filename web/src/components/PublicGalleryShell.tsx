import { LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "./ui/button";

export function PublicGalleryShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
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
            className="ml-2 flex min-w-0 flex-1 items-center gap-0.5"
            aria-label="Gallery"
          >
            <a className={buttonVariants({ variant: "ghost" })} href="/artifacts">
              Artifacts
            </a>
            <a
              aria-current="page"
              className={buttonVariants({ variant: "secondary" })}
              href="/gallery"
            >
              Gallery
            </a>
          </nav>
          <a
            className={buttonVariants({ variant: "outline" })}
            href="/?view=login"
          >
            <LogIn aria-hidden="true" data-icon="inline-start" />
            Sign in
          </a>
        </div>
      </header>
      {children}
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
