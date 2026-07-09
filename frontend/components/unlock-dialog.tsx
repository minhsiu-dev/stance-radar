"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UnlockDialog({
  open,
  onOpenChange,
  onUnlock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlock: (password: string) => Promise<boolean>;
}) {
  const t = useTranslations("Admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(false);
    const ok = await onUnlock(password);
    setBusy(false);
    if (ok) {
      setPassword("");
      onOpenChange(false);
    } else {
      setError(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPassword("");
          setError(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{t("unlockPrompt")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          <Input
            type="password"
            autoFocus
            value={password}
            aria-label={t("passwordLabel")}
            placeholder={t("passwordLabel")}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
          />
          {error && (
            <p data-testid="unlock-error" className="text-sm text-rose-600 dark:text-rose-400">
              {t("wrongPassword")}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || password.length === 0}>
              {t("unlock")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
