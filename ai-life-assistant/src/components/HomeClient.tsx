"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { AssistantItemRef, AssistantState } from "@/types/domain";
import { AppShell } from "@/components/AppShell";
import { CaptureBox } from "@/components/CaptureBox";
import { DashboardView } from "@/components/DashboardView";
import { agentPlanLanguageModels, defaultAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import { generateDashboard } from "@/lib/dashboard/generateDashboard";
import { useAssistantStore } from "@/lib/store/localStore";

function SettingsCard({
  state,
  onUpdatePreferences,
  onReset
}: {
  state: AssistantState;
  onUpdatePreferences: (preferences: AssistantState["preferences"]) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(state.preferences);
  const [saved, setSaved] = useState(false);

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
                  </option>
                ))}
              </select>
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
  const pageLabels = ["Dashboard", "输入", "设置"];

  useLayoutEffect(() => {
    const rail = railRef.current;
    const middleCard = cardRefs.current[1];
    if (!rail || !middleCard) {
      setStageReady(true);
      return;
    }
    const previousScrollBehavior = rail.style.scrollBehavior;
    rail.style.scrollBehavior = "auto";
    rail.scrollLeft = middleCard.offsetLeft - (rail.clientWidth - middleCard.clientWidth) / 2;
    rail.style.scrollBehavior = previousScrollBehavior;
    setActiveCard(1);
    setStageReady(true);
  }, []);

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
    goToCard(1);
  }

  return (
    <AppShell>
      <section className={stageReady ? "ipad-stage stage-ready" : "ipad-stage stage-booting"} aria-label="Swipeable assistant cards">
        <div className="card-rail" ref={railRef} onScroll={updateActiveCard}>
          <article
            className="swipe-card dashboard-swipe-card"
            aria-label="Dashboard card"
            ref={(node) => {
              cardRefs.current[0] = node;
            }}
          >
            <DashboardView
              dashboard={dashboard}
              state={store.state}
              onCompleteItem={store.completeItem}
              onDeleteItem={store.deleteItem}
              onDiscussItem={startItemConversation}
            />
          </article>

          <article
            className="swipe-card voice-swipe-card"
            aria-label="Voice card"
            ref={(node) => {
              cardRefs.current[1] = node;
            }}
          >
            <CaptureBox
              conversationTarget={conversationTarget}
              onClearConversationTarget={() => setConversationTarget(undefined)}
              onSubmit={async (text, inputType) => {
                const result = conversationTarget
                  ? await store.updateItemByConversation(conversationTarget, text, inputType)
                  : await store.submitInput(text, inputType);
                if (conversationTarget) setConversationTarget(undefined);
                return result;
              }}
            />
          </article>

          <article
            className="swipe-card settings-swipe-card"
            aria-label="Settings card"
            ref={(node) => {
              cardRefs.current[2] = node;
            }}
          >
            <SettingsCard state={store.state} onUpdatePreferences={store.updatePreferences} onReset={store.reset} />
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
