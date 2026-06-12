import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CommandSearch } from "@/components/command-search";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Nav");
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
          <div className="ml-auto flex items-center gap-2">
            <CommandSearch />
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
