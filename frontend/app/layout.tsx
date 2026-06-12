import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stance Radar",
  description: "追蹤訂閱頻道的美股立場",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              Stance Radar
            </Link>
            <Link
              href="/channels"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              頻道管理
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
