"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssistantItemRef } from "@/types/domain";
import { AppShell } from "@/components/AppShell";
import { DashboardView } from "@/components/DashboardView";
import { generateDashboard } from "@/lib/dashboard/generateDashboard";
import { useAssistantStore } from "@/lib/store/localStore";

export function DashboardPageClient({ initialDisplayMode = false }: { initialDisplayMode?: boolean }) {
  const store = useAssistantStore();
  const [displayMode, setDisplayMode] = useState(initialDisplayMode);
  const dashboard = useMemo(() => generateDashboard(store.state), [store.state]);

  useEffect(() => {
    setDisplayMode(new URLSearchParams(window.location.search).get("display") === "1");
  }, []);

  function toggleDisplay() {
    const next = !displayMode;
    setDisplayMode(next);
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set("display", "1");
    } else {
      url.searchParams.delete("display");
    }
    window.history.replaceState(null, "", url);
  }

  function updateFromPrompt(target: AssistantItemRef) {
    const text = window.prompt(`想怎么修改「${target.title}」？`);
    if (!text) return;
    store.updateItemByConversation(target, text, "text");
  }

  return (
    <AppShell displayMode={displayMode}>
      <DashboardView
        dashboard={dashboard}
        state={store.state}
        displayMode={displayMode}
        onToggleDisplay={toggleDisplay}
        onCompleteItem={store.completeItem}
        onDeleteItem={store.deleteItem}
        onDiscussItem={updateFromPrompt}
        onRevertItem={store.reopenItem}
        onConfirmMemory={store.confirmMemory}
        onForgetMemory={store.forgetMemory}
        onUpdateMemorySummary={store.updateMemorySummary}
      />
    </AppShell>
  );
}
