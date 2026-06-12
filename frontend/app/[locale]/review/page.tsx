import { getTranslations } from "next-intl/server";
import { ReviewList } from "@/components/review-list";

export default async function ReviewPage() {
  const t = await getTranslations("Review");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <ReviewList />
    </div>
  );
}
