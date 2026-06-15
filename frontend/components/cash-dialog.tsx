"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

export function CashDialog({ current }: { current: number }) {
  const t = useTranslations("Portfolio.cashDialog");
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [saving, setSaving] = useState(false);

  async function save() {
    const amount = Number(value);
    if (Number.isNaN(amount) || amount < 0) return;
    setSaving(true);
    try {
      await apiFetch("/api/portfolio/cash", {
        method: "PUT",
        body: JSON.stringify({ amount }),
      });
      await mutate(
        (key) => typeof key === "string" && key.startsWith("/api/portfolio"),
      );
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(String(current));
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={t("edit")} />}
      >
        <Pencil />
      </DialogTrigger>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={value}
          placeholder={t("placeholder")}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button onClick={save} disabled={saving} />}>
            {t("save")}
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
