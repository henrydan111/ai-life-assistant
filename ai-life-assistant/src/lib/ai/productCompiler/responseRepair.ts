import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { actionText } from "@/lib/ai/agentPlan/actionText";
import type { PlanTrace } from "@/lib/ai/agentPlan/types";
import {
  isExplicitRecentSleepGoal,
  isRedundantRoutineScopeCheckIn
} from "@/lib/ai/productCompiler/policies/routineGoalPolicy";
import { hasUnsafeShoppingReminderText } from "@/lib/ai/productCompiler/policies/shoppingPolicy";
import { hasUnsafeCoarseWeekendTravelText as defaultHasUnsafeCoarseWeekendTravelText } from "@/lib/ai/productCompiler/policies/travelPolicy";
import type { AssistantCheckIn } from "@/types/domain";

type UnsafeFeedbackKind = "coarse_weekend_travel" | "milk_reminder" | "routine_goal_confirmation";

type RepairFeedbackCopyOptions = {
  hasUnsafeCoarseWeekendTravelText?: (rawText: string, text: string) => boolean;
};

const unsafeClarificationQuestionPattern =
  /(确认日常目标|你要设置的日常目标|长期保持|试一段时间|短期目标还是长期目标|明天中午|明天\s*(?:12\s*点|十二点|午饭前|午餐前)|周日下午2点|本?周日\s*14\s*点|下午\s*(?:2|二|两)\s*点|14\s*(?::|：|点)\s*(?:00|30|半)?)/;

function unsafeFeedbackKind(
  rawText: string,
  text: string | undefined,
  hasUnsafeCoarseWeekendTravelText: NonNullable<RepairFeedbackCopyOptions["hasUnsafeCoarseWeekendTravelText"]>
): UnsafeFeedbackKind | undefined {
  if (!text) return undefined;
  if (hasUnsafeCoarseWeekendTravelText(rawText, text)) return "coarse_weekend_travel";
  if (hasUnsafeShoppingReminderText(rawText, text)) return "milk_reminder";
  if (
    isExplicitRecentSleepGoal(rawText) &&
    isRedundantRoutineScopeCheckIn({
      type: "add_check_in",
      title: "feedback",
      question: text,
      relatedType: "routine_goal",
      relatedRef: "feedback"
    })
  ) {
    return "routine_goal_confirmation";
  }
  return undefined;
}

function isSafeClarificationQuestion(question: string) {
  return !unsafeClarificationQuestionPattern.test(question);
}

function safeClarificationQuestions(actions: InterpretAction[], preferredSlot?: NonNullable<AssistantCheckIn["clarification"]>["slot"]) {
  const checkIns = actions.filter((action): action is Extract<InterpretAction, { type: "add_check_in" }> => action.type === "add_check_in");
  const preferred = preferredSlot
    ? checkIns.find((action) => action.clarification?.slot === preferredSlot && isSafeClarificationQuestion(action.question))?.question
    : undefined;
  if (preferred) return [preferred];
  return actions
    .filter((action): action is Extract<InterpretAction, { type: "add_check_in" }> => action.type === "add_check_in")
    .map((action) => action.question)
    .filter(isSafeClarificationQuestion);
}

function replacementQuestionForUnsafeFeedback(
  unsafeKinds: UnsafeFeedbackKind[],
  actions: InterpretAction[]
) {
  if (unsafeKinds.includes("coarse_weekend_travel")) {
    return safeClarificationQuestions(actions, "life_event_time")[0];
  }
  if (unsafeKinds.includes("routine_goal_confirmation")) {
    return safeClarificationQuestions(actions, "routine_goal_target_time")[0];
  }
  return safeClarificationQuestions(actions)[0];
}

export function repairFeedbackCopy(
  rawText: string,
  interpretation: AiInterpretation,
  trace: PlanTrace[],
  options: RepairFeedbackCopyOptions = {}
): AiInterpretation {
  const hasUnsafeCoarseWeekendTravelText = options.hasUnsafeCoarseWeekendTravelText ?? defaultHasUnsafeCoarseWeekendTravelText;
  const titleKind = unsafeFeedbackKind(rawText, interpretation.feedback.title, hasUnsafeCoarseWeekendTravelText);
  const detailKind = unsafeFeedbackKind(rawText, interpretation.feedback.detail, hasUnsafeCoarseWeekendTravelText);
  const questionKind = unsafeFeedbackKind(rawText, interpretation.feedback.question, hasUnsafeCoarseWeekendTravelText);
  const unsafeKinds = [titleKind, detailKind, questionKind].filter((kind): kind is UnsafeFeedbackKind => Boolean(kind));
  if (!unsafeKinds.length) return interpretation;

  const replacement = questionKind ? replacementQuestionForUnsafeFeedback(unsafeKinds, interpretation.actions) : interpretation.feedback.question;
  const feedback = {
    ...interpretation.feedback,
    title: titleKind ? "已整理事项" : interpretation.feedback.title,
    detail: detailKind ? "我已按已确认的信息整理，并把不确定的部分留作确认。" : interpretation.feedback.detail,
    question: questionKind ? replacement : interpretation.feedback.question
  };
  trace.push({
    rule: "feedback.repair.remove_unsafe_default_confirmation",
    severity: "repair",
    before: {
      title: interpretation.feedback.title,
      detail: interpretation.feedback.detail,
      question: interpretation.feedback.question
    },
    after: {
      title: feedback.title,
      detail: feedback.detail,
      question: feedback.question
    },
    reason: "Feedback should not ask the user to confirm invented defaults or restate explicit routine goals."
  });
  return { ...interpretation, feedback };
}
