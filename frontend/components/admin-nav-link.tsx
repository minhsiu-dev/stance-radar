"use client";

import { Link } from "@/i18n/navigation";
import { useAdmin } from "@/components/admin-provider";

/** A nav link that only exists for an unlocked session (the server-rendered shell
 *  can't know whether the browser is unlocked). */
export function AdminNavLink({
  href,
  label,
  className,
  onClick,
}: {
  href: string;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  const { authenticated } = useAdmin();
  if (!authenticated) return null;
  return (
    <Link href={href} className={className} onClick={onClick}>
      {label}
    </Link>
  );
}
