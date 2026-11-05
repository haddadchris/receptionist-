"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Shield } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { useT } from "@/i18n/client";
import { initials } from "@/lib/utils";
import { switchBusinessAction } from "@/app/dashboard/actions";

export function UserMenu({
  user,
  businesses,
  currentBusinessId,
  isSuperAdmin,
}: {
  user: { name: string | null; email: string };
  businesses: { businessId: string; businessName: string }[];
  currentBusinessId: string;
  isSuperAdmin: boolean;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg p-1.5 text-start hover:bg-accent">
        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(user.name ?? user.email)}</span>
        <span className="hidden min-w-0 flex-col sm:flex">
          <span className="truncate text-sm font-medium">{user.name ?? user.email}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel dir="ltr">{user.email}</DropdownMenuLabel>
        {businesses.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            {businesses.map((b) => (
              <DropdownMenuItem
                key={b.businessId}
                onSelect={async () => {
                  await switchBusinessAction(b.businessId);
                  router.refresh();
                }}
              >
                {b.businessId === currentBusinessId ? <Check /> : <span className="size-4" />}
                {b.businessName}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {isSuperAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <Shield /> {t("nav.admin")}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <form action="/auth/logout" method="post">
          <button type="submit" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <LogOut className="size-4" /> {t("common.signOut")}
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
