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
  // The font CSS variables must be attached to <html> and not wrapped in an outer div,
  // otherwise the <html> rendered by [locale]/layout.tsx can't read them and falls back to
  // Times. They are applied by the locale layout via fontVariables.
  return <>{children}</>;
}
