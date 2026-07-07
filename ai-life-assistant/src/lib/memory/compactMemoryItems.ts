import type { MemoryItem } from "@/types/domain";
import { normalizeMemoryItems } from "@/lib/memory/applyMemoryWrites";

const suggestedTtlDays = 30;
const lowConfidenceTtlDays = 90;

function ageDays(iso: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000));
}

export function compactMemoryItems(items: MemoryItem[]) {
  return normalizeMemoryItems(
    items.map((item) => {
      if (item.status === "suggested" && ageDays(item.updatedAt) > suggestedTtlDays) {
        return { ...item, status: "archived" as const };
      }
      if (item.status === "active" && item.confidence < 0.5 && !item.lastUsedAt && ageDays(item.updatedAt) > lowConfidenceTtlDays) {
        return { ...item, status: "archived" as const };
      }
      return item;
    })
  );
}

