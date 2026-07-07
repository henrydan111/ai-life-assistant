"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { AssistantItemRef, AssistantState, ParseFeedback } from "@/types/domain";
import { AppShell } from "@/components/AppShell";
import { CaptureBox } from "@/components/CaptureBox";
import { DashboardView } from "@/components/DashboardView";
import { MemoryList } from "@/components/MemoryList";
import { TrackerCard } from "@/components/TrackerCard";
import { agentPlanLanguageModels, defaultAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import { generateDashboard } from "@/lib/dashboard/generateDashboard";
import { useAssistantStore } from "@/lib/store/localStore";

function SettingsCard({
  state,
  onUpdatePreferences,
  onReset,
  onConfirmMemory,
  onForgetMemory,
  onUpdateMemorySummary
}: {
  state: AssistantState;
  onUpdatePreferences: (preferences: AssistantState["preferences"]) => void;
  onReset: () => void;
  onConfirmMemory: (memoryId: string) => void;
  onForgetMemory: (memoryId: string) => void;
  onUpdateMemorySummary: (memoryId: string, summary: string) => void;
}) {
  const [draft, setDraft] = useState(state.preferences);
  const [saved, setSaved] = useState(false);
  const selectedModel =
    agentPlanLanguageModels.find((model) => model.id === (draft.languageModel ?? defaultAgentPlanLanguageModel)) ??
    agentPlanLanguageModels.find((model) => model.id === defaultAgentPlanLanguageModel);

  useEffect(() => {
    setDraft(state.preferences);
  }, [state.preferences]);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  return (
    <section className="settings-card-view" aria-label="Settings and history">
      <header className="card-section-header">
        <p className="eyebrow">Settings</p>
        <h2 className="card-title">偏好、信息与历史</h2>
      </header>

      <div className="settings-card-grid">
        <section className="settings-section" aria-label="User preferences">
          <h3>用户偏好</h3>
          <div className="settings-fields">
            <div className="field">
              <label htmlFor="home-display-name">称呼</label>
              <input id="home-display-name" className="input" value={draft.displayName} onChange={(event) => update("displayName", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="home-language">语言</label>
              <select
                id="home-language"
                className="select"
                value={draft.preferredLanguage}
                onChange={(event) => update("preferredLanguage", event.target.value as "en" | "zh")}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="home-style">计划风格</label>
              <select
                id="home-style"
                className="select"
                value={draft.planningStyle}
                onChange={(event) => update("planningStyle", event.target.value as "light" | "balanced" | "ambitious")}
              >
                <option value="light">轻量</option>
                <option value="balanced">平衡</option>
                <option value="ambitious">积极</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="home-model">模型</label>
              <select id="home-model" className="select" value={draft.languageModel ?? defaultAgentPlanLanguageModel} onChange={(event) => update("languageModel", event.target.value)}>
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
          </div>
        </section>

        <section className="settings-section" aria-label="User information">
          <h3>个人节奏</h3>
          <div className="settings-fields two-col">
            <div className="field">
              <label htmlFor="home-wake">起床时间</label>
              <input id="home-wake" className="input" type="time" value={draft.wakeTime} onChange={(event) => update("wakeTime", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="home-sleep">睡觉时间</label>
              <input id="home-sleep" className="input" type="time" value={draft.sleepTime} onChange={(event) => update("sleepTime", event.target.value)} />
            </div>
          </div>
          <div className="field mt-4">
            <label htmlFor="home-interests">关注方向</label>
            <textarea
              id="home-interests"
              className="input text-area-input"
              value={draft.informationInterests.join(", ")}
              onChange={(event) =>
                update(
                  "informationInterests",
                  event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                )
              }
            />
          </div>
        </section>

        <section className="settings-section history-section" aria-label="Conversation history">
          <h3>历史会话</h3>
          <ol className="history-list">
            {state.inputs.length > 0 ? (
              state.inputs.slice(0, 8).map((input) => (
                <li key={input.id}>
                  <span>{input.inputType === "voice" ? "语音" : "文字"}</span>
                  <p>{input.rawText}</p>
                  <small>{new Date(input.createdAt).toLocaleString()}</small>
                </li>
              ))
            ) : (
              <li>
                <span>暂无</span>
                <p>新的语音和文字输入会出现在这里。</p>
              </li>
            )}
          </ol>
        </section>

        <section className="settings-section memory-settings-section" aria-label="Assistant memory">
          <h3>AI 记住了</h3>
          <MemoryList
            memories={state.memoryItems.filter((memory) => memory.status === "active" || memory.status === "suggested").slice(0, 8)}
            emptyText="还没有长期记忆。"
            onConfirmMemory={onConfirmMemory}
            onForgetMemory={onForgetMemory}
            onUpdateMemorySummary={onUpdateMemorySummary}
          />
        </section>
      </div>

      <footer className="settings-actions">
        <button
          className="text-button primary"
          type="button"
          onClick={() => {
            onUpdatePreferences(draft);
            setSaved(true);
          }}
        >
          <Save size={17} aria-hidden="true" />
          保存
        </button>
        <button className="text-button" type="button" onClick={onReset}>
          <RotateCcw size={17} aria-hidden="true" />
          重置
        </button>
        {saved ? <p role="status">已保存到本机。</p> : null}
      </footer>
    </section>
  );
}

export function HomeClient() {
  const store = useAssistantStore();
  const railRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeCard, setActiveCard] = useState(1);
  const [stageReady, setStageReady] = useState(false);
  const [conversationTarget, setConversationTarget] = useState<AssistantItemRef | undefined>();
  const dashboard = useMemo(() => generateDashboard(store.state), [store.state]);
  const voiceCardIndex = 2;
  const pageLabels = ["统计", "Dashboard", "输入", "设置"];

  useLayoutEffect(() => {
    const rail = railRef.current;
    const voiceCard = cardRefs.current[voiceCardIndex];
    if (!rail || !voiceCard) {
      setStageReady(true);
      return;
    }
    const previousScrollBehavior = rail.style.scrollBehavior;
    rail.style.scrollBehavior = "auto";
    rail.scrollLeft = voiceCard.offsetLeft - (rail.clientWidth - voiceCard.clientWidth) / 2;
    rail.style.scrollBehavior = previousScrollBehavior;
    setActiveCard(voiceCardIndex);
    setStageReady(true);
  }, [voiceCardIndex]);

  function updateActiveCard() {
    const rail = railRef.current;
    if (!rail) return;

    const railCenter = rail.scrollLeft + rail.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - railCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveCard(closestIndex);
  }

  function goToCard(index: number) {
    cardRefs.current[index]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setActiveCard(index);
  }

  function startItemConversation(target: AssistantItemRef) {
    setConversationTarget(target);
    goToCard(voiceCardIndex);
  }

  return (
    <AppShell>
      <section className={stageReady ? "ipad-stage stage-ready" : "ipad-stage stage-booting"} aria-label="Swipeable assistant cards">
        <div className="card-rail" ref={railRef} onScroll={updateActiveCard}>
          <article
            className="swipe-card tracker-swipe-card"
            aria-label="Tracker card"
            ref={(node) => {
              cardRefs.current[0] = node;
            }}
          >
            <TrackerCard state={store.state} onDeleteItem={store.deleteItem} onRevertItem={store.reopenItem} />
          </article>

          <article
            className="swipe-card dashboard-swipe-card"
            aria-label="Dashboard card"
            ref={(node) => {
              cardRefs.current[1] = node;
            }}
          >
            <DashboardView
              dashboard={dashboard}
              state={store.state}
              onCompleteItem={store.completeItem}
              onDeleteItem={store.deleteItem}
              onDiscussItem={startItemConversation}
              onRevertItem={store.reopenItem}
              onConfirmMemory={store.confirmMemory}
              onForgetMemory={store.forgetMemory}
              onUpdateMemorySummary={store.updateMemorySummary}
            />
          </article>

          <article
            className="swipe-card voice-swipe-card"
            aria-label="Voice card"
            ref={(node) => {
              cardRefs.current[2] = node;
            }}
          >
            <CaptureBox
              timezone={store.state.preferences.timezone}
              conversationTarget={conversationTarget}
              onClearConversationTarget={() => setConversationTarget(undefined)}
              onSubmit={async (text, inputType, onProgress, metadata) => {
                const result: ParseFeedback = conversationTarget
                  ? await store.updateItemByConversation(conversationTarget, text, inputType)
                  : await store.submitInput(text, inputType, onProgress, metadata);
                if (conversationTarget && !result.question) setConversationTarget(undefined);
                return result;
              }}
            />
          </article>

          <article
            className="swipe-card settings-swipe-card"
            aria-label="Settings card"
            ref={(node) => {
              cardRefs.current[3] = node;
            }}
          >
            <SettingsCard
              state={store.state}
              onUpdatePreferences={store.updatePreferences}
              onReset={store.reset}
              onConfirmMemory={store.confirmMemory}
              onForgetMemory={store.forgetMemory}
              onUpdateMemorySummary={store.updateMemorySummary}
            />
          </article>
        </div>
        <nav className="swipe-dots" aria-label="页面位置">
          {pageLabels.map((label, index) => (
            <button
              key={label}
              className={activeCard === index ? "active" : undefined}
              type="button"
              onClick={() => goToCard(index)}
              aria-current={activeCard === index ? "page" : undefined}
              aria-label={`切换到${label}页面`}
            />
          ))}
        </nav>
      </section>
    </AppShell>
  );
}
