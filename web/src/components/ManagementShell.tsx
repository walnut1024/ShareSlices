import { LogOutIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { User } from "../api/account";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button, buttonVariants } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";
import { Toaster } from "./ui/sonner";

export function ManagementShell({
  user,
  signingOut,
  onSignOut,
  children
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
          <a aria-label="ShareSlices artifacts" className="flex shrink-0 items-center gap-[9px]" href="/artifacts">
            <span aria-hidden="true" className="flex size-7 flex-col items-center justify-center gap-0.5 rounded-lg bg-foreground">
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background" />
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background/55" />
              <span className="h-0.5 w-[13px] rounded-[1px] bg-background/30" />
            </span>
            <span className="text-[14.5px] font-semibold tracking-[-0.01em]">ShareSlices</span>
          </a>
          <nav aria-label="Management" className="ml-2 flex min-w-0 flex-1 items-center gap-0.5">
            <a aria-current="page" className={buttonVariants({ variant: "secondary" })} href="/artifacts">Artifacts</a>
          </nav>
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button aria-label="Open account menu" className="h-[38px] max-w-56 rounded-full pr-3 pl-1" variant="outline" />}
              >
                <Avatar className="size-8">
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-xs">{user.name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-foreground">{user.name}</span>
                      <span className="truncate font-normal">{user.email}</span>
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={signingOut} onClick={onSignOut}>
                    <LogOutIcon />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] px-8 py-7">{children}</main>
      <Toaster />
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}
