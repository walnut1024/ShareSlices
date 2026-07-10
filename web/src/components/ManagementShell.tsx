import { FileStack, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { User } from "../api/account";

export function ManagementShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-5 px-4 sm:px-6">
          <a className="shrink-0 font-semibold text-neutral-950" href="/artifacts">
            ShareSlices
          </a>
          <nav aria-label="Management" className="flex min-w-0 flex-1 items-center gap-1">
            <a className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-neutral-700 hover:bg-neutral-100" href="/artifacts">
              <FileStack aria-hidden="true" className="size-4" />
              Artifacts
            </a>
            <a className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-neutral-700 hover:bg-neutral-100" href="/artifacts/new">
              <Plus aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">New artifact</span>
            </a>
          </nav>
          <span className="max-w-32 truncate text-sm text-neutral-500">{user.name}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
