import type { Metadata } from "next";
import { Geist, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const notoTC = Noto_Sans_TC({
  subsets: ["latin"],
  variable: "--font-noto-tc",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stance Radar",
  description: "Track US-stock stances across YouTube channels you follow.",
};

export const fontVariables = `${geistSans.variable} ${notoTC.variable}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 字型 CSS 變數必須掛在 <html> 上,不能被外層 div 包住,否則 [locale]/layout.tsx
  // 渲染的 <html> 拿不到變數 → fallback 到 Times。透過 fontVariables 由 locale layout 套用。
  return <>{children}</>;
}
