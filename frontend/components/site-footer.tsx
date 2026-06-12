import { getTranslations } from "next-intl/server";

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-3 py-4 text-xs text-muted-foreground sm:px-4">
        <span>{t("disclaimer")}</span>
        <span>{t("sources")}</span>
      </div>
    </footer>
  );
}
