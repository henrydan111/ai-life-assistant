export type EnergyLevel = "low" | "medium" | "high";
export type Priority = "low" | "medium" | "high";
export type Horizon = "now" | "today" | "this_week" | "later" | "someday";

export type Task = {
  id: string;
  title: string;
  description?: string;
  type: "task" | "project_step" | "reminder" | "waiting_for" | "habit";
  horizon: Horizon;
  dueAt?: string;
  estimatedMinutes?: number;
  energyRequired: EnergyLevel;
  priority: Priority;
  status: "todo" | "doing" | "done" | "deferred" | "cancelled";
  sourceInputId?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  title: string;
  description?: string;
  status: "active" | "paused" | "done";
  targetDate?: string;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
};

export type ShoppingItem = {
  id: string;
  itemName: string;
  quantity?: string;
  category?: string;
  status: "needed" | "ordered" | "bought" | "removed";
  expectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MoodLog = {
  id: string;
  moodLabel: string;
  energyLevel: EnergyLevel;
  note?: string;
  createdAt: string;
};

export type LifeEvent = {
  id: string;
  title: string;
  description?: string;
  category: "travel" | "class" | "appointment" | "household" | "outing" | "other";
  startsAt?: string;
  endsAt?: string;
  location?: string;
  participants: string[];
  status: "planned" | "confirmed" | "done" | "cancelled";
  sourceInputId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantCheckIn = {
  id: string;
  title: string;
  question: string;
  relatedType: "task" | "shopping_item" | "life_event" | "project";
  relatedId: string;
  askAt: string;
  status: "pending" | "answered" | "dismissed";
  createdAt: string;
};

export type RecurrenceCandidate = {
  id: string;
  normalizedTitle: string;
  relatedType: "task" | "shopping_item" | "life_event";
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  suggestedRule?: string;
  status: "watching" | "suggested" | "accepted" | "rejected";
};

export type UserPreferences = {
  displayName: string;
  preferredLanguage: "en" | "zh";
  languageModel?: string;
  wakeTime: string;
  sleepTime: string;
  planningStyle: "light" | "balanced" | "ambitious";
  informationInterests: string[];
};

export type RawInput = {
  id: string;
  rawText: string;
  inputType: "text" | "voice";
  parsedSummary: string;
  createdAt: string;
};

export type AssistantState = {
  version: 1;
  preferences: UserPreferences;
  tasks: Task[];
  projects: Project[];
  shoppingItems: ShoppingItem[];
  moodLogs: MoodLog[];
  lifeEvents: LifeEvent[];
  checkIns: AssistantCheckIn[];
  recurrenceCandidates: RecurrenceCandidate[];
  inputs: RawInput[];
};

export type DashboardData = {
  now?: {
    id: string;
    title: string;
    reason: string;
    due?: string;
  };
  today: Array<{
    id: string;
    title: string;
    status: Task["status"];
    due?: string;
    priority: Priority;
  }>;
  progress: {
    completed: number;
    total: number;
    label: string;
  };
  week: Array<{
    id: string;
    title: string;
    progress: number;
  }>;
  shopping: Array<{
    id: string;
    itemName: string;
    status: ShoppingItem["status"];
    expectedAt?: string;
  }>;
  state: string;
  prompts: AssistantCheckIn[];
};

export type ParseFeedback = {
  title: string;
  detail: string;
  question?: string;
};

export type AssistantItemRef = {
  id: string;
  title: string;
  kind: "task" | "life_event" | "check_in" | "shopping_item";
};
