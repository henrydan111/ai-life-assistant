import type { InterpretAction } from "@/lib/ai/interpretation";
import { actionText } from "./actionText";
import { hasSeparateTravelPrepCheckIn, travelPrepCategoriesIn } from "./travelPrepPolicy";

function rawHasAmbiguousSleepDeadline(rawText: string) {
  return rawText
    .split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/)
    .some((segment) => {
      const mentionsSleep = /(睡觉|睡|上床|休息)/.test(segment);
      const mentionsTwelveBefore = /(12|十二)\s*[点:：]?\s*前/.test(segment);
      const hasDisambiguator = /(中午|上午|下午|晚上|今晚|凌晨|零点|0点|24点|二十四点)/.test(segment);
      return mentionsSleep && mentionsTwelveBefore && !hasDisambiguator;
    });
}

function rawHasThursdayFridayLeave(rawText: string) {
  return /(周四|星期四)/.test(rawText) && /(周五|星期五)/.test(rawText) && /请假/.test(rawText);
}

function rawHasShanghaiTrip(rawText: string) {
  return /上海/.test(rawText) && /(周日|周天|星期日|星期天)/.test(rawText) && /(去|高铁|火车|往返|晚饭|吃饭|订票)/.test(rawText);
}

function rawHasSuzhouTrip(rawText: string) {
  return /苏州/.test(rawText) && /(去|出差|旅行|出行|周|星期|明天|后天)/.test(rawText);
}

function rawRequestsMilk(rawText: string) {
  return /牛奶/.test(rawText) && /(买|需要|没有|没了|缺|下单|订)/.test(rawText);
}

function rawHasKidsClass(rawText: string) {
  return /(孩子|小孩|儿子|女儿|兴趣班)/.test(rawText) && /兴趣班/.test(rawText);
}

function hasAction(actions: InterpretAction[], type: InterpretAction["type"], pattern: RegExp) {
  return actions.some((action) => action.type === type && pattern.test(actionText(action)));
}

function hasRelatedCheckIn(actions: InterpretAction[], pattern: RegExp, relatedType?: "task" | "shopping_item" | "life_event" | "project") {
  return actions.some(
    (action) =>
      action.type === "add_check_in" &&
      (!relatedType || action.relatedType === relatedType) &&
      pattern.test(actionText(action))
  );
}

export function validateCoreIntentCoverage(rawText: string, actions: InterpretAction[], feedbackQuestion?: string, finalStructure = false) {
  const errors: string[] = [];
  const combinedText = [feedbackQuestion, ...actions.map(actionText)].filter(Boolean).join(" ");

  if (rawHasAmbiguousSleepDeadline(rawText)) {
    const sleepTasks = actions.filter(
      (action): action is Extract<InterpretAction, { type: "add_task" }> =>
        action.type === "add_task" && /(睡觉|睡|上床|休息)/.test(actionText(action))
    );
    if (!sleepTasks.length) {
      errors.push("原文包含“今天12点前睡觉”意图，但最终 actions 缺少睡觉目标 add_task。");
    }
    if (sleepTasks.some((task) => Boolean(task.dueAt))) {
      errors.push("“今天12点前睡觉”语义不清，确认前睡觉目标不应写入具体 dueAt。");
    }
    if (!/(睡|休息|12点|十二点)/.test(combinedText) || !/(中午|今晚|24|几点|提醒)/.test(combinedText)) {
      errors.push("“今天12点前睡觉”需要在 feedback.question 或 add_check_in 中追问中午/今晚/提醒时间。");
    }
  }

  if (rawHasThursdayFridayLeave(rawText)) {
    const hasCombinedLeaveTask = actions.some((action) => {
      const text = actionText(action);
      return action.type === "add_task" && /请假/.test(text) && /周四|星期四|四/.test(text) && /周五|星期五|五/.test(text);
    });
    if (!hasCombinedLeaveTask) {
      errors.push("原文包含周四和周五请假，最终 actions 必须有一个覆盖两天的请假 add_task。");
    }
    const hasBossReminder = finalStructure
      ? hasRelatedCheckIn(actions, /老板|领导|请假|提前/, "task")
      : actions.some((action) => action.type === "add_check_in" && /老板|领导|请假|提前/.test(actionText(action)));
    if (/老板|领导|提前|提醒/.test(rawText) && !hasBossReminder) {
      errors.push(
        finalStructure
          ? "原文要求提醒提前和老板说，请假提醒必须作为 relatedType=task 的 add_check_in 返回。"
          : "原文要求提醒提前和老板说，actions 中必须覆盖老板沟通提醒。"
      );
    }
  }

  if (rawHasShanghaiTrip(rawText)) {
    if (finalStructure && !hasAction(actions, "add_life_event", /上海/)) {
      errors.push("原文包含周日去上海安排，最终 actions 缺少上海 life_event。");
    } else if (!finalStructure && !actions.some((action) => /上海/.test(actionText(action)))) {
      errors.push("原文包含上海安排，但 actions 中没有覆盖上海相关意图。");
    }
    const prepCheckInText = actions
      .filter((action) => action.type === "add_check_in" && action.relatedType === "life_event")
      .map(actionText)
      .join(" ");
    const shanghaiText = finalStructure ? prepCheckInText : combinedText;
    if (/(高铁|火车|车票|订票|买票|票务|往返)/.test(rawText) && !/(高铁|火车|车票|订票|买票|票务|票)/.test(shanghaiText)) {
      errors.push("上海行程提到票务/高铁，必须在 relatedType=life_event 的 add_check_in 中包含票务确认。");
    }
    if (/行李|收拾/.test(rawText) && !/行李|收拾/.test(shanghaiText)) {
      errors.push("上海行程提到行李，必须在 relatedType=life_event 的 add_check_in 中包含行李确认。");
    }
    const hasShanghaiPrepReminder = finalStructure
      ? hasRelatedCheckIn(actions, /上海|行前|高铁|火车|车票|票|行李|收拾/, "life_event")
      : actions.some((action) => /上海|行前|高铁|火车|车票|票|行李|收拾/.test(actionText(action)));
    if (/提醒|到时候|准备/.test(rawText) && !hasShanghaiPrepReminder) {
      errors.push(
        finalStructure
          ? "上海行程的准备提醒必须挂到 life_event 下面，不能作为并列主待办或只写在 feedback 里。"
          : "上海行程的准备提醒必须在 actions 中体现，不能只写在 feedback 里。"
      );
    }
    const requestedPrepCategories = travelPrepCategoriesIn(rawText);
    if (finalStructure && requestedPrepCategories.length > 1) {
      requestedPrepCategories.forEach((category) => {
        if (!hasSeparateTravelPrepCheckIn(actions, category.pattern)) {
          errors.push(`上海行程中的“${category.title}”必须是独立 relatedType=life_event 的 add_check_in，不能和其他确认项合并。`);
        }
      });
    }
  }

  if (rawHasSuzhouTrip(rawText) && !actions.some((action) => /苏州/.test(actionText(action)))) {
    errors.push("原文包含苏州出行安排，但 actions 中没有覆盖苏州相关意图。");
  }

  if (rawRequestsMilk(rawText) && !actions.some((action) => /牛奶/.test(actionText(action)))) {
    errors.push("原文包含牛奶购买/下单意图，但 actions 中没有覆盖牛奶。");
  }

  if (rawHasKidsClass(rawText)) {
    if (!actions.some((action) => /兴趣班/.test(actionText(action)))) {
      errors.push("原文包含孩子兴趣班安排，但 actions 中没有覆盖兴趣班。");
    }
    if (!/(持续|多久|结束|多长时间)/.test(rawText) && !/(持续|多久|结束|多长时间)/.test(combinedText)) {
      errors.push("孩子兴趣班缺少持续时间时，需要在 feedback.question 或 add_check_in 中追问持续多久。");
    }
  }

  return errors;
}
