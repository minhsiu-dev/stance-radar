"use client";

import { Lock, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/components/admin-provider";
import { UnlockDialog } from "@/components/unlock-dialog";

export function AdminLockButton() {
  const t = useTranslations("Admin");
  const { ready, enabled, authenticated, dialogOpen, setDialogOpen, promptUnlock, lock, unlock } =
    useAdmin();

  // Hide until we know the state, and when the lock feature is off (no password configured).
  if (!ready || !enabled) return null;

  return (
    <>
      {authenticated ? (
        <Button variant="ghost" size="icon" aria-label={t("lockAria")} onClick={() => lock()}>
          <Unlock className="size-4" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" aria-label={t("unlockAria")} onClick={promptUnlock}>
          <Lock className="size-4" />
        </Button>
      )}
      <UnlockDialog open={dialogOpen} onOpenChange={setDialogOpen} onUnlock={unlock} />
    </>
  );
}
