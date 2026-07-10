"use client";

import { Lock, Settings, Unlock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAdmin } from "@/components/admin-provider";
import { UnlockDialog } from "@/components/unlock-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LOCALES = [
  { code: "en", label: "EN" },
  { code: "zh-TW", label: "繁中" },
] as const;

export function SettingsMenu() {
  const t = useTranslations("Settings");
  const ta = useTranslations("Admin");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Admin lock lives here (not a standalone header button); only shown when the
  // lock feature is configured (a password is set). Backend enforces regardless.
  const { ready, enabled, authenticated, dialogOpen, setDialogOpen, promptUnlock, lock, unlock } =
    useAdmin();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={t("open")} />}
        >
          <Settings className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuCheckboxItem
            checked={mounted && resolvedTheme === "dark"}
            onCheckedChange={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {t("theme")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("language")}
            </DropdownMenuLabel>
            {LOCALES.map((l) => (
              <DropdownMenuCheckboxItem
                key={l.code}
                checked={locale === l.code}
                onCheckedChange={() =>
                  router.replace(pathname, { locale: l.code as "en" | "zh-TW" })
                }
              >
                {l.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {ready && enabled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => (authenticated ? lock() : promptUnlock())}
              >
                {authenticated ? (
                  <Unlock className="mr-2 size-4" />
                ) : (
                  <Lock className="mr-2 size-4" />
                )}
                {authenticated ? ta("lockAria") : ta("unlockAria")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {enabled && (
        <UnlockDialog open={dialogOpen} onOpenChange={setDialogOpen} onUnlock={unlock} />
      )}
    </>
  );
}
