import type { AiInterpretation } from "@/lib/ai/interpretation";
import { actionText } from "@/lib/ai/agentPlan/actionText";
import type { PlanTrace } from "@/lib/ai/agentPlan/types";

const unsupportedMilkReminderTimePattern =
  /(明天\s*(?:中午|12\s*点|十二点|午饭前|午餐前)|(?:中午|12\s*点|十二点|午饭前|午餐前).*牛奶|牛奶.*(?:中午|12\s*点|十二点|午饭前|午餐前))/;

function segmentMentioning(rawText: string, pattern: RegExp) {
  return rawText.split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/).find((segment) => pattern.test(segment)) ?? rawText;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExplicitReminderTimeOfDay(rawText: string, pattern: RegExp) {
  const segment = segmentMentioning(rawText, pattern);
  return /(今晚|明早|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：))/.test(segment);
}

function hasUntimedMilkShoppingNeed(rawText: string) {
  return /牛奶/.test(rawText) && /(买|需要|没有|没了|缺|快没了|提醒)/.test(rawText) && !hasExplicitReminderTimeOfDay(rawText, /牛奶/);
}

function hasDateOnlyMilkShoppingTiming(rawText: string) {
  const segment = segmentMentioning(rawText, /牛奶/);
  const hasDate = /(明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天])/.test(segment);
  const hasTimeOfDay = /(今晚|明早|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：))/.test(segment);
  return hasDate && !hasTimeOfDay;
}

function hasExplicitRecurringMilkMemoryIntent(rawText: string) {
  const segment = segmentMentioning(rawText, /牛奶/);
  return /(以后|每次|每当|只要|都提醒|自动|定期|固定|每周|每月|经常|总是|一直|长期|规律|快没(?:了)?就|用完就|没了就)/.test(
    segment
  );
}

function isUnsupportedMilkMemoryWrite(write: AiInterpretation["memoryWrites"][number]) {
  const text = [write.summary, write.evidence, ...(write.tags ?? []), ...(write.entities ?? [])].filter(Boolean).join(" ");
  return /牛奶/.test(text) && /(定期|重复|recurring|每周|每月|经常|总是|快用完|补充|补货|提醒|购买|买|没了|缺|需要)/.test(text);
}

function removeUnsupportedMilkReminderTimes(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  if (!hasUntimedMilkShoppingNeed(rawText)) return interpretation;

  const actions = interpretation.actions.map((action) => {
    if (action.type === "add_task" && /牛奶/.test(actionText(action)) && action.dueAt) {
      const repaired = {
        ...action,
        dueAt: undefined,
        horizon: hasDateOnlyMilkShoppingTiming(rawText) ? ("later" as const) : action.horizon
      };
      trace.push({
        rule: "temporal.repair.remove_unsupported_milk_due_at",
        severity: "repair",
        before: action,
        after: repaired,
        reason: "The user asked to remember buying milk but did not provide a reminder time."
      });
      return repaired;
    }
    if (action.type === "add_shopping_item" && /牛奶/.test(action.itemName) && action.dueAt) {
      const repaired = { ...action, dueAt: undefined };
      trace.push({
        rule: "temporal.repair.remove_unsupported_milk_shopping_due_at",
        severity: "repair",
        before: action,
        after: repaired,
        reason: "The user asked to remember buying milk but did not provide a reminder time."
      });
      return repaired;
    }
    return action;
  });

  return { ...interpretation, actions };
}

function removeUnsupportedMilkMemoryWrites(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  if (!hasUntimedMilkShoppingNeed(rawText) || hasExplicitRecurringMilkMemoryIntent(rawText) || !interpretation.memoryWrites.length) {
    return interpretation;
  }

  const memoryWrites = interpretation.memoryWrites.filter((write) => {
    if (!isUnsupportedMilkMemoryWrite(write)) return true;
    trace.push({
      rule: "memory.repair.drop_one_off_milk_recurring",
      severity: "repair",
      before: write,
      after: undefined,
      reason: "A one-off milk shopping reminder should not be promoted into a recurring memory without explicit recurring language."
    });
    return false;
  });

  return memoryWrites.length === interpretation.memoryWrites.length ? interpretation : { ...interpretation, memoryWrites };
}

function ensureShoppingPurchaseTasks(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  const actions = interpretation.actions.map((action) => {
    if (action.type !== "add_shopping_item" || action.createTask || (action.status && action.status !== "needed")) {
      return action;
    }
    const segment = segmentMentioning(rawText, new RegExp(escapeRegExp(action.itemName)));
    if (
      !/(提醒|买|购买|采购|需要|没有|没了|缺|快没了|补货)/.test(segment) ||
      /(不要|不用|别|取消|不需要|问|看看|确认|是否|要不要|需不需要|室友|别人|家人)/.test(segment)
    ) {
      return action;
    }
    const repaired = { ...action, createTask: true };
    trace.push({
      rule: "shopping.repair.ensure_purchase_task",
      severity: "repair",
      before: action,
      after: repaired,
      reason: "The user expressed a shopping purchase/reminder need, so the shopping item should also appear as an actionable task."
    });
    return repaired;
  });
  return { ...interpretation, actions };
}

export function hasUnsafeShoppingReminderText(rawText: string, text: string) {
  return hasUntimedMilkShoppingNeed(rawText) && unsupportedMilkReminderTimePattern.test(text);
}

export function applyShoppingPolicy(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]) {
  const withoutUnsupportedTimes = removeUnsupportedMilkReminderTimes(rawText, interpretation, trace);
  const withoutUnsupportedMemoryWrites = removeUnsupportedMilkMemoryWrites(rawText, withoutUnsupportedTimes, trace);
  return ensureShoppingPurchaseTasks(rawText, withoutUnsupportedMemoryWrites, trace);
}
