import { DashboardPageClient } from "@/components/DashboardPageClient";

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ display?: string | string[] }>;
}) {
  const params = await searchParams;
  const displayValue = Array.isArray(params?.display) ? params.display[0] : params?.display;

  return <DashboardPageClient initialDisplayMode={displayValue === "1"} />;
}
