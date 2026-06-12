import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CommandSearch } from "@/components/command-search";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Nav");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-3 sm:gap-6 sm:px-4">
          <Link href="/" className="shrink-0 font-semibold">
            {t("brand")}
          </Link>
          <Link
            href="/portfolio"
            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("portfolio")}
          </Link>
          <Link
            href="/channels"
            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("channels")}
          </Link>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <CommandSearch />
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
