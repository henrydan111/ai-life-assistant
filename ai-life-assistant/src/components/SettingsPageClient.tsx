"use client";

import { RotateCcw, Save } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MemoryList } from "@/components/MemoryList";
import { agentPlanLanguageModels, defaultAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import { useAssistantStore } from "@/lib/store/localStore";

export function SettingsPageClient() {
  const store = useAssistantStore();
  const [draft, setDraft] = useState(store.state.preferences);
  const [saved, setSaved] = useState(false);
  const titleId = useId();
  const formId = useId();
  const selectedModel =
    agentPlanLanguageModels.find((model) => model.id === (draft.languageModel ?? defaultAgentPlanLanguageModel)) ??
    agentPlanLanguageModels.find((model) => model.id === defaultAgentPlanLanguageModel);

  useEffect(() => {
    setDraft(store.state.preferences);
  }, [store.state.preferences]);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  return (
    <AppShell>
      <div className="mx-auto grid max-w-3xl gap-4">
        <section className="panel" aria-labelledby={titleId}>
          <div className="panel-inner">
            <p className="eyebrow">Settings</p>
            <h1 id={titleId} className="page-title">
              Keep it light.
            </h1>
          </div>
        </section>

        <section className="panel" aria-labelledby={formId}>
          <div className="panel-inner">
            <h2 id={formId} className="sr-only">
              Assistant preferences
            </h2>
            <div className="settings-grid">
              <div className="field">
                <label htmlFor="displayName">Display name</label>
                <input id="displayName" className="input" value={draft.displayName} onChange={(event) => update("displayName", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="language">Language</label>
                <select
                  id="language"
                  className="select"
                  value={draft.preferredLanguage}
                  onChange={(event) => update("preferredLanguage", event.target.value as "en" | "zh")}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="languageModel">语言模型</label>
                <select
                  id="languageModel"
                  className="select"
                  value={draft.languageModel ?? defaultAgentPlanLanguageModel}
                  onChange={(event) => update("languageModel", event.target.value)}
                >
                  {agentPlanLanguageModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.id === defaultAgentPlanLanguageModel ? "（推荐）" : ""}
                    </option>
                  ))}
                </select>
                <p className="model-note">
                  {selectedModel?.description ?? "当前模型将用于理解、检查和整理你的输入。"} Thinking 已关闭。
                </p>
              </div>
              <div className="field">
                <label htmlFor="wakeTime">Wake time</label>
                <input id="wakeTime" className="input" type="time" value={draft.wakeTime} onChange={(event) => update("wakeTime", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="sleepTime">Sleep time</label>
                <input id="sleepTime" className="input" type="time" value={draft.sleepTime} onChange={(event) => update("sleepTime", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="style">Planning style</label>
                <select
                  id="style"
                  className="select"
                  value={draft.planningStyle}
                  onChange={(event) => update("planningStyle", event.target.value as "light" | "balanced" | "ambitious")}
                >
                  <option value="light">Light</option>
                  <option value="balanced">Balanced</option>
                  <option value="ambitious">Ambitious</option>
                </select>
              </div>
            </div>
            <div className="button-row mt-5">
              <button
                className="text-button primary"
                type="button"
                onClick={() => {
                  store.updatePreferences(draft);
                  setSaved(true);
                }}
              >
                <Save size={17} aria-hidden="true" />
                Save
              </button>
              <button className="text-button warn" type="button" onClick={store.reset}>
                <RotateCcw size={17} aria-hidden="true" />
                Reset local data
              </button>
            </div>
            {saved ? (
              <p className="state-line mt-3" role="status" aria-live="polite">
                Saved locally on this browser.
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-label="Assistant memory">
          <div className="panel-inner">
            <p className="eyebrow">Memory</p>
            <h2 className="section-title mb-3">AI 记住了</h2>
            <MemoryList
              memories={store.state.memoryItems.filter((memory) => memory.status === "active" || memory.status === "suggested")}
              emptyText="还没有长期记忆。之后我会把可复用的生活模式放在这里，并让你确认。"
              onConfirmMemory={store.confirmMemory}
              onForgetMemory={store.forgetMemory}
              onUpdateMemorySummary={store.updateMemorySummary}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
