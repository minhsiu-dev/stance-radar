"use client";

import { useTranslations } from "next-intl";
import { FailedVideos } from "@/components/failed-videos";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { FailureKind } from "@/lib/types";

/** Slides in from the right when a lane's failed count is clicked. */
export function FailedDrawer({
  kind,
  onClose,
}: {
  kind: FailureKind | null;
  onClose: () => void;
}) {
  const t = useTranslations("Pipeline.drawer");
  return (
    <Sheet
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-xl">
        {kind && (
          <>
            <SheetTitle>{t(kind)}</SheetTitle>
            <FailedVideos kind={kind} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
