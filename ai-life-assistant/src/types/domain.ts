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
  priority: Priority;
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
  relatedType: "task" | "shopping_item" | "life_event" | "project" | "memory";
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

export type MemoryItem = {
  id: string;
  type:
    | "household"
    | "preference"
    | "recurring_pattern"
    | "travel_habit"
    | "weather_preference"
    | "assistant_behavior"
    | "open_loop";
  summary: string;
  tags: string[];
  entities: string[];
  confidence: number;
  status: "active" | "suggested" | "rejected" | "archived";
  sensitivity: "low" | "medium" | "high";
  evidence: Array<{
    text: string;
    inputId?: string;
    createdAt: string;
  }>;
  lastUsedAt?: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryWrite = {
  type: MemoryItem["type"];
  summary: string;
  tags?: string[];
  entities?: string[];
  confidence: number;
  sensitivity?: MemoryItem["sensitivity"];
  requiresConfirmation?: boolean;
  evidence: string;
};

export type MemoryContext = {
  stableFacts: string[];
  activePatterns: string[];
  openLoops: string[];
  assistantPreferences: string[];
  pendingConfirmations: string[];
};

export type TranscriptRepair = {
  rawTranscript: string;
  transcript: string;
  confidence: number;
  needsUserConfirmation: boolean;
  question?: string;
  repairs: Array<{
    from?: string;
    to?: string;
    reason: string;
  }>;
};

export type UserPreferences = {
  displayName: string;
  preferredLanguage: "en" | "zh";
  languageModel?: string;
  modelChoiceVersion?: number;
  timezone: string;
  wakeTime: string;
  sleepTime: string;
  planningStyle: "light" | "balanced" | "ambitious";
  informationInterests: string[];
};

export type RawInput = {
  id: string;
  rawText: string;
  originalText?: string;
  transcriptRepair?: Omit<TranscriptRepair, "rawTranscript" | "transcript">;
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
  memoryItems: MemoryItem[];
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

export type AiProcessingStage =
  | "speech"
  | "transcript_repair"
  | "understanding"
  | "coverage"
  | "planning"
  | "saving"
  | "done";

export type AiProcessingStatus = "waiting" | "active" | "complete" | "attention" | "error";

export type AiProcessingUpdate = {
  stage: AiProcessingStage;
  status: AiProcessingStatus;
  title: string;
  detail?: string;
};

export type AssistantItemRef = {
  id: string;
  title: string;
  kind: "task" | "life_event" | "check_in" | "shopping_item";
};
