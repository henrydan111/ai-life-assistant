"use client";

import { useId, useState } from "react";
import type { ParseFeedback } from "@/types/domain";
import { AppShell } from "@/components/AppShell";
import { CaptureBox } from "@/components/CaptureBox";
import { useAssistantStore } from "@/lib/store/localStore";

export function InputPageClient() {
  const store = useAssistantStore();
  const [feedback, setFeedback] = useState<ParseFeedback | undefined>();
  const recentTitleId = useId();

  return (
    <AppShell>
      <div className="mx-auto grid max-w-2xl gap-4">
        <CaptureBox
          feedback={feedback}
          onSubmit={async (text, inputType, onProgress, metadata) => {
            const result = await store.submitInput(text, inputType, onProgress, metadata);
            setFeedback(result);
            return result;
          }}
        />
        <section className="panel" aria-labelledby={recentTitleId}>
          <div className="panel-inner">
            <h2 id={recentTitleId} className="section-title mb-3">
              Recent inputs
            </h2>
            <ul className="task-list">
              {store.state.inputs.length > 0 ? (
                store.state.inputs.slice(0, 5).map((input) => (
                  <li className="task-item" key={input.id}>
                    <div className="item-main">
                      <div className="item-title">{input.rawText}</div>
                      <div className="item-meta">{new Date(input.createdAt).toLocaleString()}</div>
                    </div>
                  </li>
                ))
              ) : (
                <li className="task-item">
                  <div className="item-main">
                    <div className="item-title">No recent inputs</div>
                    <div className="item-meta">New captures will appear here.</div>
                  </div>
                </li>
              )}
            </ul>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
