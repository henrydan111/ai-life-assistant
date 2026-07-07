# AI Life Assistant POC Brief

## 1. Product Thesis

Build a lightweight AI personal-life assistant that turns a user's messy natural-language inputs into a calm, actionable life dashboard.

The first medium is not new hardware. It is an existing phone, old iPad, old Android tablet, or spare browser screen. The product should make unused screens valuable again by turning them into an always-visible personal operating panel.

Working concept:

> Idle screen + AI life noise reduction + voice entry + context-aware to-do system.

This is not a normal to-do list, calendar, news reader, smart display, or generic chatbot. The core value is that the user does not need to maintain a system. The user says what is in their head; the AI converts it into a clear, sparse, prioritized life queue.

## 2. Strategic Positioning

Recommended positioning:

> A calm AI life dashboard that tells you what matters now.

Alternative product language:

- AI life noise reducer
- Idle-screen life assistant
- A personal operating panel for daily life
- One button in, one calm screen out

The product should avoid positioning itself as:

- Another to-do list app
- A productivity power-user tool
- A generic AI companion
- A family calendar replacement
- A news aggregator

The wedge is a small, simple entry point with strong downstream workflow:

1. One voice or text input.
2. AI extracts intent.
3. AI classifies, prioritizes, asks follow-up questions, and updates state.
4. The spare screen shows only what deserves attention.

## 3. Core User Problem

Users have too many scattered life signals:

- Short-term tasks: "send the report this afternoon."
- Medium-term tasks: "finish the research this week."
- Long-term goals: "build an AI hardware/product POC."
- Household needs: "buy milk, paper towels, detergent."
- Emotional state: "I am tired today; do not overload me."
- External information: "What should I know today that affects my goals?"

Existing tools split these across reminders, calendars, notes, chat apps, shopping lists, browser tabs, RSS, social feeds, and memory. The user still has to decide what matters.

This product's promise:

> You only speak. The assistant decides how to organize it, what to ask, and what to show.

## 4. Target First Users

Prioritize users with frequent mental clutter and visible daily planning pain.

Recommended first segment:

1. Knowledge workers and solo builders
   - They have work tasks, personal goals, reading lists, projects, and information overload.
   - They are more willing to try AI workflows.

2. High-pressure professionals with scattered life admin
   - They need a simple "today only" view and cannot maintain complex task systems.

3. Couples or small households, only after single-user mode works
   - Household shopping and shared reminders are attractive, but multi-user sync should not be in the first build.

Do not start with children, elder care, mental-health treatment, medical advice, or regulated decisioning.

## 5. Differentiation From Existing Products

### Versus Tiimo

Tiimo's likely core value is structured visual planning, routines, and support for users who need clarity around time, routines, and executive function.

Do not compete by becoming a more complex visual planner.

Our difference:

- Tiimo helps users follow a structured plan.
- This product helps users convert messy life input into a sparse plan.

### Versus Skylight

Skylight's likely core value is a dedicated family calendar and household display that makes family logistics visible.

Do not compete by selling hardware or becoming a family-calendar device.

Our difference:

- Skylight is family coordination hardware.
- This product is AI-first life compression on devices users already own.

### Versus Todoist / Things / Reminders

Traditional task apps assume the user is willing to manage the system.

Our difference:

- Task apps store tasks.
- This assistant interprets, reshapes, and reduces tasks.

### Versus Motion / Reclaim / Sunsama

AI scheduling tools optimize calendars and work blocks.

Our difference:

- Scheduling tools optimize time.
- This product optimizes attention across tasks, emotions, household needs, and selected external information.

### Versus ChatGPT / Claude

General chatbots can help if prompted, but they do not persistently own a user's life state or display it in a calm dashboard.

Our difference:

- Chatbots answer.
- This assistant maintains state and updates a living dashboard.

## 6. Product Pillars

### Pillar 1: Universal Capture

The user has one input point:

- Voice button.
- Text fallback.
- Later: share sheet, widgets, NFC tags, Bluetooth button.

Input examples:

- "I need to send the report by 5, buy milk tonight, and I am too tired for heavy tasks."
- "The AI product research should be done this week. Break it into steps."
- "Add paper towels to the household list."
- "I finished the report."
- "Tomorrow remind me to call the insurance company."

### Pillar 2: AI Structuring

The AI converts free-form input into structured records:

- Tasks
- Projects
- Shopping items
- Mood/energy state
- Waiting-for items
- Reminders
- Questions requiring confirmation
- Information interests

### Pillar 3: Clarifying Questions

If the AI lacks critical information, it should ask a short question instead of guessing.

Examples:

- "What time today should this be done by?"
- "Is this a one-time task or a recurring habit?"
- "Should this be shown on your dashboard today or saved for later?"

### Pillar 4: Calm Dashboard

The dashboard should be sparse. It is not a feed.

Recommended first-screen sections:

1. Now
   - The single most important action.

2. Today
   - At most three priority tasks.

3. Progress
   - A simple progress bar or count.

4. This Week
   - One to three active projects.

5. Household
   - Shopping or simple home items.

6. State
   - Energy/mood note that affects planning.

7. Brief
   - Optional: one to three high-signal external information cards.

### Pillar 5: Context-Aware Information

The product can include external information, but only as filtered context.

Do not build a news feed in POC.

The right formulation:

> Not "show me more news"; show me fewer things that matter to my current goals.

Example:

If the user is building an AI life-assistant POC, the dashboard can show:

- One relevant competitor update.
- One useful technical article.
- One market signal or product example.

This should be based on user goals, active projects, and interests, not generic trending topics.

## 7. POC Scope

The POC should prove five things:

1. Users will capture real-life tasks through a single voice/text entry point.
2. AI can reliably convert messy input into useful structured records.
3. Users value a sparse daily dashboard more than another list.
4. Old phones/tablets can serve as a useful passive display.
5. A small amount of context-aware information improves value without creating noise.

## 8. MVP Feature Set

### Must Have

1. User account
   - Email magic link or simple auth.

2. Universal input
   - Text input first.
   - Voice input if browser support is easy.
   - Transcribed text should be editable before submit.

3. AI parse endpoint
   - Convert natural language into structured actions.
   - Return confidence and missing fields.

4. Internal tools
   - create_task
   - update_task
   - split_task
   - reprioritize
   - add_to_shopping_list
   - log_mood
   - ask_clarifying_question
   - generate_dashboard
   - generate_daily_brief

5. Dashboard view
   - Responsive browser/PWA display for old phone/tablet.
   - Should work in portrait and landscape.
   - Should support "display mode" with large typography and minimal controls.

6. State update through same input
   - "I finished X."
   - "Move Y to tomorrow."
   - "I am tired; reduce today's plan."
   - "Add Z to shopping."

7. Basic information brief
   - User can add up to 5 RSS/source URLs or interests.
   - System produces at most 3 cards per day.
   - Each card must explain why it matters to the user's current projects.

### Should Have

1. Onboarding wizard
   - Ask for top projects, daily routine, preferred wake/sleep times, information interests.

2. Manual edit
   - Let user correct task title, date, priority, and category.

3. Dashboard refresh button
   - Recompute today's view.

4. Basic history
   - Show completed tasks and mood logs.

### Must Not Have In POC

- Native iOS/Android app.
- App Store launch.
- New hardware.
- Multi-user household collaboration.
- Automatic purchasing.
- Payment automation.
- Deep calendar sync.
- Full email integration.
- Full browser extension.
- Medical, therapy, or financial advice.
- Infinite feed.
- Full social/news recommendation engine.
- Complex gamification.

## 9. Core Data Model

### users

- id
- email
- created_at
- timezone
- display_name

### user_preferences

- user_id
- preferred_language
- wake_time
- sleep_time
- planning_style
- max_daily_tasks
- information_interests

### tasks

- id
- user_id
- title
- description
- type: task | project_step | reminder | waiting_for | habit
- horizon: now | today | this_week | later | someday
- due_at
- estimated_minutes
- energy_required: low | medium | high
- priority: low | medium | high
- status: todo | doing | done | deferred | cancelled
- source_input_id
- confidence
- created_at
- updated_at

### projects

- id
- user_id
- title
- description
- status
- target_date
- progress_percent
- created_at
- updated_at

### shopping_items

- id
- user_id
- item_name
- quantity
- category
- status: needed | bought | removed
- created_at
- updated_at

### mood_logs

- id
- user_id
- mood_label
- energy_level: low | medium | high
- note
- created_at

### inputs

- id
- user_id
- raw_text
- input_type: text | voice
- transcript
- parsed_json
- created_at

### dashboard_snapshots

- id
- user_id
- date
- generated_json
- created_at

### info_sources

- id
- user_id
- source_type: rss | website | keyword | manual_link
- source_value
- enabled
- created_at

### info_cards

- id
- user_id
- title
- source_url
- summary
- why_it_matters
- related_project_id
- score
- created_at

## 10. AI Tool Contract

The AI should not directly mutate the database without returning structured tool calls.

Example input:

> I need to send the strategy review to Henry by 5pm, buy milk tonight, and I am exhausted today. Make the day lighter.

Expected tool calls:

```json
[
  {
    "tool": "create_task",
    "arguments": {
      "title": "Send strategy review to Henry",
      "horizon": "today",
      "due_at": "17:00",
      "priority": "high",
      "energy_required": "medium"
    }
  },
  {
    "tool": "add_to_shopping_list",
    "arguments": {
      "item_name": "milk",
      "status": "needed"
    }
  },
  {
    "tool": "log_mood",
    "arguments": {
      "mood_label": "tired",
      "energy_level": "low",
      "note": "User asked to make today's plan lighter."
    }
  },
  {
    "tool": "reprioritize",
    "arguments": {
      "strategy": "reduce_today_to_critical_tasks"
    }
  }
]
```

If information is missing, return:

```json
{
  "needs_confirmation": true,
  "question": "What deadline should I use for this task?"
}
```

## 11. Dashboard Content Contract

The dashboard should never show too much.

Hard limits:

- Now: 1 item.
- Today: max 3 priority items.
- This Week: max 3 projects.
- Shopping: max 5 visible items.
- Brief: max 3 info cards.
- Mood/state: 1 sentence.

Dashboard JSON shape:

```json
{
  "now": {
    "title": "Send strategy review",
    "reason": "Highest-priority deadline today",
    "due": "17:00"
  },
  "today": [
    {"title": "Send strategy review", "status": "todo"},
    {"title": "Buy milk", "status": "todo"},
    {"title": "Take a 20-minute walk", "status": "todo"}
  ],
  "progress": {
    "completed": 1,
    "total": 4,
    "label": "1/4 done"
  },
  "week": [
    {"title": "AI life assistant POC", "progress": 30}
  ],
  "shopping": ["milk", "paper towels"],
  "state": "Energy is low today, so non-critical tasks are deferred.",
  "brief": [
    {
      "title": "Relevant AI dashboard product update",
      "summary": "Short summary only.",
      "why_it_matters": "Related to your POC research."
    }
  ]
}
```

## 12. Information Brief Design

The information module is valuable only if it is context-aware.

Bad version:

- "Here are today's AI news headlines."
- Infinite cards.
- Generic trending topics.

Good version:

- "Here are 1-3 things related to your current goals."
- Each card explains relevance.
- Cards can be dismissed, saved, or converted into tasks.

POC implementation:

1. User enters interests and sources manually.
2. System fetches RSS or simple website summaries once per day.
3. AI scores relevance against:
   - active projects
   - recent tasks
   - user interests
   - dashboard state
4. System displays top 3 only.

Do not implement broad web crawling in POC.

## 13. Technical Recommendation

Recommended POC stack:

- Frontend: Next.js + React + Tailwind CSS
- App shape: PWA/browser-first
- Backend: Next.js API routes or lightweight server
- Database/Auth: Supabase
- AI: OpenAI API or compatible LLM provider
- Speech:
  - Phase 1: browser Web Speech API if available, text fallback mandatory
  - Phase 2: API-based transcription
- Hosting: Vercel
- Background jobs: Vercel Cron / Supabase scheduled functions / simple server cron
- RSS parsing: Node RSS parser library

Avoid:

- Native app before retention is proven.
- Complex mobile push infrastructure in week 1.
- Heavy multi-agent orchestration.

## 14. Suggested Repo Structure

```text
ai-life-assistant/
  README.md
  .env.example
  package.json
  src/
    app/
      page.tsx
      dashboard/page.tsx
      input/page.tsx
      settings/page.tsx
    components/
      VoiceInput.tsx
      DashboardCard.tsx
      TodayPanel.tsx
      BriefPanel.tsx
      ShoppingPanel.tsx
    lib/
      ai/
        parseInput.ts
        generateDashboard.ts
        generateBrief.ts
        toolSchemas.ts
      db/
        supabaseClient.ts
        queries.ts
      rss/
        fetchSources.ts
        rankCards.ts
    server/
      actions/
        tasks.ts
        shopping.ts
        mood.ts
        dashboard.ts
    types/
      domain.ts
  supabase/
    schema.sql
```

## 15. POC Build Plan For Codex

### Phase 0: Bootstrap

Goal:

Create a working Next.js PWA shell with dashboard and input pages.

Tasks:

1. Initialize Next.js app with TypeScript.
2. Add Tailwind CSS.
3. Create responsive layout.
4. Add routes:
   - `/`
   - `/input`
   - `/dashboard`
   - `/settings`
5. Add mock data for dashboard.

Acceptance:

- App runs locally.
- Dashboard is readable on desktop, phone, and tablet widths.
- No database or AI required yet.

### Phase 1: Local Structured State

Goal:

Make the dashboard work using local mock state or localStorage.

Tasks:

1. Define domain types.
2. Implement task, shopping, mood, project models.
3. Add text input.
4. Add simple rule-based parser for obvious commands.
5. Render updates to dashboard.

Acceptance:

- User can type "buy milk" and see shopping update.
- User can type "finish report by 5pm" and see today's tasks update.
- User can mark task done.

### Phase 2: AI Parsing

Goal:

Replace rule-only parsing with LLM structured output.

Tasks:

1. Create tool schemas.
2. Add `/api/parse-input`.
3. Implement AI parser returning tool calls.
4. Apply tool calls to data store.
5. Add clarification question flow.

Acceptance:

- A multi-intent sentence creates multiple records.
- Ambiguous input produces a question instead of bad guesses.
- Parsed output is inspectable in dev logs.

### Phase 3: Supabase Persistence

Goal:

Persist state across devices.

Tasks:

1. Create Supabase schema.
2. Add auth.
3. Store tasks, shopping items, mood logs, projects, inputs.
4. Add dashboard snapshot generation.

Acceptance:

- User can log in.
- Same dashboard opens on another device.
- Old tablet can stay on `/dashboard`.

### Phase 4: Display Mode

Goal:

Make spare-device display useful.

Tasks:

1. Add display mode toggle.
2. Add large typography.
3. Add auto-refresh.
4. Add burn-in-safe subtle layout shift or refresh.
5. Hide editing controls in display mode.

Acceptance:

- Dashboard works as always-on screen.
- User can update state from phone and see display update.

### Phase 5: Context-Aware Brief

Goal:

Add minimal information reduction.

Tasks:

1. Add info source settings.
2. Fetch RSS/manual sources.
3. Summarize and rank items against active projects.
4. Show max 3 brief cards.
5. Allow dismiss/save/create task from info card.

Acceptance:

- User sees only 1-3 relevant information cards.
- Each card has "why this matters."
- No infinite feed.

## 16. UX Principles

1. One input, many outcomes.
2. The dashboard should feel calmer after using it.
3. Never show everything.
4. AI should ask short questions, not long explanations.
5. Manual correction must be easy.
6. Old devices should be display-first, not editing-first.
7. The product should reduce cognitive load, not create a new system to manage.

## 17. First Screen Draft

Main input screen:

```text
What is on your mind?

[ Hold to speak ]

or type here...
```

Dashboard screen:

```text
Today, only this matters.

Now
Send the strategy review by 5:00 PM

Today
1. Send the strategy review
2. Buy milk
3. 20-minute walk

This Week
AI life assistant POC: 30%

Household
Milk, paper towels

State
Low energy today. Non-critical tasks are deferred.

Brief
3 things worth knowing for your current projects.
```

## 18. Metrics To Track

### Activation

- User creates first task through natural language.
- User opens dashboard on a second device.
- User returns within 24 hours.

### Engagement

- Inputs per active user per day.
- Dashboard views per day.
- State updates per day.
- Task completion rate.
- Clarification question response rate.

### Retention

- D1 retention.
- D7 retention.
- Number of users who keep display mode open.

### Value

- User reports lower mental load.
- User says dashboard shows the right things.
- User says AI classification is trustworthy.

### Monetization Signals

- Willingness to pay after 7 days.
- Preferred price point.
- Which feature users would pay for:
  - AI planning
  - dashboard display
  - information brief
  - weekly review
  - household list

## 19. Key Risks

1. Users do not want to speak long-term.
   - Mitigation: text input must be equally good.

2. Users do not trust AI categorization.
   - Mitigation: show short reasoning and allow fast correction.

3. Dashboard becomes cluttered.
   - Mitigation: hard limits on visible items.

4. Spare-device display is a novelty, not a habit.
   - Mitigation: measure second-device display usage.

5. AI costs exceed subscription price.
   - Mitigation: use small models, structured outputs, limited brief frequency.

6. Product becomes too broad.
   - Mitigation: first build task/state/dashboard only; information brief is limited.

7. Competes directly with family calendar or task apps.
   - Mitigation: emphasize life compression and context-aware display, not feature parity.

## 20. Pricing Hypothesis

Do not optimize monetization in POC, but design cost boundaries.

Potential pricing:

- Free: limited daily AI inputs, no brief.
- Personal: 29-39 CNY/month.
- Pro: 59-79 CNY/month with information brief and weekly review.
- Family later: 99-129 CNY/month.

Do not launch low-cost unlimited AI usage.

## 21. 30-Day Validation Plan

### Week 1

- Build clickable prototype or mock web dashboard.
- Interview 10-15 users.
- Manually process their voice/text inputs using an LLM.
- Test whether they like the resulting dashboard.

### Week 2

- Build PWA shell.
- Implement manual text input and mock AI parser.
- Test on old iPad/phone screens.

### Week 3

- Add real AI parser.
- Add basic dashboard generation.
- Start testing with 5-10 users.

### Week 4

- Add persistence.
- Track usage.
- Ask for willingness to pay.
- Decide whether display mode and daily dashboard are actually useful.

## 22. 90-Day POC Milestones

### Month 1

Build working prototype:

- Text/voice input.
- AI parse.
- Dashboard.
- Old-device display mode.

### Month 2

Closed beta with 20-50 users:

- Measure daily input.
- Measure dashboard usage.
- Add corrections and clarification flow.
- Add limited information brief.

### Month 3

Decide product direction:

- If dashboard retention is strong, improve display mode.
- If AI parsing is strongest, focus on assistant workflow.
- If information brief is strongest, reposition toward context-aware daily briefing.
- If no daily habit forms, stop or pivot.

## 23. Codex Implementation Instructions

When building the POC:

1. Prefer a browser-first PWA.
2. Avoid native app work.
3. Keep the UI sparse and display-oriented.
4. Implement mock data first, then persistence.
5. Build AI parsing as a replaceable module.
6. Make every AI action visible and reversible.
7. Add hard limits to dashboard density.
8. Do not add social features, gamification, or complex settings.
9. Document all environment variables in `.env.example`.
10. Include a README with local setup, architecture, and POC limitations.

## 24. Suggested First Codex Prompt

Use this prompt to start implementation:

```text
We are building a POC for an AI Life Assistant: a browser-first PWA that turns natural-language life inputs into a calm dashboard for old phones/iPads.

Read `ai_life_assistant_poc_brief.md` fully before coding.

Build Phase 0 and Phase 1 only:
1. Create a Next.js + TypeScript + Tailwind PWA shell.
2. Add pages: `/`, `/input`, `/dashboard`, `/settings`.
3. Implement a sparse dashboard using mock/localStorage data.
4. Implement text input that can add simple tasks, shopping items, and mood notes with a rule-based parser.
5. Add responsive display mode for old tablets/phones.
6. Keep UI minimal: one input, one dashboard, no feature sprawl.
7. Do not implement auth, paid plans, real AI, RSS, or native app features yet.

Acceptance:
- The app runs locally.
- A user can type "send report by 5pm", "buy milk", and "I am tired today" and see the dashboard update.
- Dashboard shows at most: one Now item, three Today items, three Week projects, five Shopping items, one State line.
- The dashboard is readable on a phone-sized viewport and tablet-sized viewport.
- Include README setup instructions.
```

