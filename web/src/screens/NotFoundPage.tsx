import { PublicSiteShell } from "../components/PublicSiteShell";
import { buttonVariants } from "../components/ui/button";

export function NotFoundPage() {
  return (
    <PublicSiteShell>
      <main id="main-content" className="grid min-h-[calc(100vh-64px)] place-items-center px-6 py-20">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-muted-foreground">404</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Page not found
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The address may be incorrect or the page is no longer available.
          </p>
          <a className={buttonVariants({ className: "mt-6" })} href="/">
            Back to Website
          </a>
        </div>
      </main>
    </PublicSiteShell>
  );
}
