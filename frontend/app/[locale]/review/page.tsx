import { redirect } from "@/i18n/navigation";

// Picking discovered videos moved into the import page's inbox.
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/pipeline", locale });
}
