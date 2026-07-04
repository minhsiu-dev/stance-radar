"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrivacy } from "@/components/privacy-provider";
import { UnlockDialog } from "@/components/unlock-dialog";

// SSR + first client render both see ready=false -> Skeleton (no hydration mismatch),
// and the holdings children only mount (and fetch) when ready && !locked.
export function PortfolioGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Portfolio");
  const { locked, ready } = usePrivacy();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!ready) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (locked) {
    return (
      <div
        data-testid="holdings-hidden"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center"
      >
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("hiddenTitle")}</p>
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          {t("unlock")}
        </Button>
        <UnlockDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </div>
    );
  }
  return <>{children}</>;
}
