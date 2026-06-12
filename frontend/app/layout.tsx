import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stance Radar",
  description: "Track US-stock stances across YouTube channels you follow.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
