"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrivacy } from "@/components/privacy-provider";

// Gates the /portfolio page body. SSR + first client render both see ready=false ->
// Skeleton (no hydration mismatch), and the holdings children only mount (and fetch)
// when ready && !hideHoldings, so they never flash or fetch while hidden.
export function PortfolioGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Portfolio");
  const { hideHoldings, ready, toggle } = usePrivacy();

  if (!ready) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (hideHoldings) {
    return (
      <div
        data-testid="holdings-hidden"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center"
      >
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("hiddenTitle")}</p>
        <Button variant="outline" size="sm" onClick={toggle}>
          {t("showHoldings")}
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
