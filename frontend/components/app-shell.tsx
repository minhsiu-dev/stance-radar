import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Nav");
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" className="font-semibold">
            {t("brand")}
          </Link>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("dashboard")}
          </Link>
          <Link
            href="/channels"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("channels")}
          </Link>
          {/* Search / Language / Theme slots filled in Phase B */}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
