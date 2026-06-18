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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePrivacy } from "@/components/privacy-provider";

const LOCALES = [
  { code: "en", label: "EN" },
  { code: "zh-TW", label: "繁中" },
] as const;

export function SettingsMenu() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { hideHoldings, toggle } = usePrivacy();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // base-ui uses render instead of Radix's asChild
        render={<Button variant="ghost" size="icon" aria-label={t("open")} />}
      >
        <Settings className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuCheckboxItem
          checked={hideHoldings}
          onCheckedChange={toggle}
        >
          {t("hideHoldings")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mounted && resolvedTheme === "dark"}
          onCheckedChange={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
        >
          {t("theme")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* base-ui's GroupLabel must be wrapped inside a Group */}
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
  );
}
