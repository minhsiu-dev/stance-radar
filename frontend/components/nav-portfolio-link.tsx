"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePrivacy } from "@/components/privacy-provider";

// The /portfolio link, hidden when Hide Holdings is on. (No holdings data — just the
// label — so it can show by default until the setting is read; it blinks one frame at
// most on the privacy path, which is acceptable.)
export function NavPortfolioLink({ className }: { className?: string }) {
  const t = useTranslations("Nav");
  const { hideHoldings } = usePrivacy();
  if (hideHoldings) return null;
  return (
    <Link href="/portfolio" className={className}>
      {t("portfolio")}
    </Link>
  );
}
