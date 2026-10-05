import { redirect } from "@/i18n/navigation";

// Failure triage moved into the import page's per-lane drawers.
export default async function FailedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/pipeline", locale });
}
