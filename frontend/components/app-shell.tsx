import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CommandSearch } from "@/components/command-search";
import { NavPortfolioLink } from "@/components/nav-portfolio-link";
import { SettingsMenu } from "@/components/settings-menu";
import { SiteFooter } from "@/components/site-footer";
import { MobileNav } from "@/components/mobile-nav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Nav");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="mx-auto flex max-w-6xl items-center gap-3 px-3 h-14 sm:gap-6 sm:px-4">
          <Link href="/" className="shrink-0 font-semibold">
            {t("brand")}
          </Link>
          <div className="md:hidden">
            <MobileNav />
          </div>
          <div className="hidden items-center gap-3 sm:gap-6 md:flex">
            <Link href="/" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">
              {t("home")}
            </Link>
            <Link href="/stocks" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">
              {t("trending")}
            </Link>
            <Link href="/videos" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">
              {t("videos")}
            </Link>
            <Link href="/channels" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">
              {t("channels")}
            </Link>
            <NavPortfolioLink className="shrink-0 text-sm text-muted-foreground hover:text-foreground" />
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <CommandSearch />
            <SettingsMenu />
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
