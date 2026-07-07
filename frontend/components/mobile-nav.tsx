"use client"

import { Menu } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

// Keep in sync with the desktop nav links in app-shell.tsx
const LINKS = [
  { href: "/", key: "home" },
  { href: "/stocks", key: "trending" },
  { href: "/videos", key: "videos" },
  { href: "/channels", key: "channels" },
] as const

export function MobileNav() {
  const t = useTranslations("Nav")
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("openMenu")} />
        }
      >
        <Menu className="h-4 w-4" />
      </SheetTrigger>
      <SheetContent side="left" className="gap-2">
        <SheetTitle className="px-1 py-2">{t("brand")}</SheetTitle>
        <nav className="flex flex-col">
          {LINKS.map(({ href, key }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="rounded-md px-1 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t(key)}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
