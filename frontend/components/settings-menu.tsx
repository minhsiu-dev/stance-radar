"use client";

import { Settings } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
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
import { usePrivacy } from "@/components/privacy-provider";
import { UnlockDialog } from "@/components/unlock-dialog";

const LOCALES = [
  { code: "en", label: "EN" },
  { code: "zh-TW", label: "繁中" },
] as const;

export function SettingsMenu() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { enabled, authenticated, lock } = usePrivacy();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={t("open")} />}
        >
          <Settings className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {enabled &&
            (authenticated ? (
              <DropdownMenuItem onClick={() => lock()}>
                {t("lockHoldings")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => setUnlockOpen(true)}>
                {t("unlockHoldings")}
              </DropdownMenuItem>
            ))}
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
        </DropdownMenuContent>
      </DropdownMenu>
      <UnlockDialog open={unlockOpen} onOpenChange={setUnlockOpen} />
    </>
  );
}
