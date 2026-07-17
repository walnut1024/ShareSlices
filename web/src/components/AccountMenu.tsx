import { LogOutIcon, UserRoundIcon } from "lucide-react";
import type { User } from "../api/account";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function AccountMenu({
  user,
  signingOut,
  onSignOut,
}: {
  user: User;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Open account menu"
            className="h-[38px] max-w-56 rounded-full pr-3 pl-1"
            variant="outline"
          />
        }
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
          <DropdownMenuItem render={<a href="/settings/gallery-profile" />}>
            <UserRoundIcon />
            Creator profile
          </DropdownMenuItem>
          <DropdownMenuItem disabled={signingOut} onClick={onSignOut}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
