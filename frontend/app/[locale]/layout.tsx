import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { fontVariables } from "@/app/layout";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { PrivacyProvider } from "@/components/privacy-provider";
import { SWRProvider } from "@/components/swr-provider";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      // 字型變數必須在 html 上:font-sans 的 var(--font-geist-sans) 才解析得到
      className={`${fontVariables} font-sans`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          storageKey="stance-radar-theme"
        >
          <NextIntlClientProvider messages={messages}>
            <SWRProvider>
              <PrivacyProvider>
                <AppShell>{children}</AppShell>
              </PrivacyProvider>
            </SWRProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
