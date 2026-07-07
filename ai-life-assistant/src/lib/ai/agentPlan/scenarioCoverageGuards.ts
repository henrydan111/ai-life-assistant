import type { InterpretAction } from "@/lib/ai/interpretation";
import { actionText } from "./actionText";
import { rawHasRecurringSleepGoal, resolveRecurringSleepTarget } from "./temporalPolicy";
import { hasSeparateTravelPrepCheckIn, travelPrepCategoriesIn } from "./travelPrepPolicy";

function rawHasAmbiguousSleepDeadline(rawText: string) {
  if (rawHasRecurringSleepGoal(rawText)) return false;
  return rawText
    .split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/)
    .some((segment) => {
      const mentionsSleep = /(睡觉|睡|上床|休息)/.test(segment);
      const mentionsTwelveBefore = /(12|十二)\s*[点:：]?\s*前/.test(segment);
      const hasDisambiguator = /(中午|上午|下午|晚上|今晚|凌晨|零点|0点|24点|二十四点|半夜|午夜)/.test(segment);
      return mentionsSleep && mentionsTwelveBefore && !hasDisambiguator;
    });
}

function rawHasThursdayFridayLeave(rawText: string) {
  return /(周四|星期四)/.test(rawText) && /(周五|星期五)/.test(rawText) && /请假/.test(rawText);
}

function rawHasShanghaiTrip(rawText: string) {
  return /上海/.test(rawText) && /(周日|周天|星期日|星期天)/.test(rawText) && /(去|高铁|火车|往返|晚饭|吃饭|订票)/.test(rawText);
}

function rawRequestsShanghaiPrep(rawText: string) {
  return /上海/.test(rawText) && /(提醒|到时候|行前|高铁|火车|车票|订票|买票|票务|往返|行李|收拾|餐馆|餐厅|饭店|订位|订座)/.test(rawText);
}

function rawHasSuzhouTrip(rawText: string) {
  return /苏州/.test(rawText) && /(去|出差|旅行|出行|周|星期|明天|后天)/.test(rawText);
}

function rawRequestsMilk(rawText: string) {
  return /牛奶/.test(rawText) && /(买|需要|没有|没了|缺|下单|订)/.test(rawText);
}

function segmentMentioning(rawText: string, pattern: RegExp) {
  return rawText.split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/).find((segment) => pattern.test(segment)) ?? rawText;
}

function hasExplicitTimeInSegment(segment: string) {
  return /(今天|明天|后天|今晚|明早|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：)|20\d{2})/.test(segment);
}

function rawHasExplicitMilkReminderTime(rawText: string) {
  return hasExplicitTimeInSegment(segmentMentioning(rawText, /牛奶/));
}

function rawHasCoarseWeekendShanghaiTrip(rawText: string) {
  if (!/上海/.test(rawText) || !/(周末|本周末|这周末)/.test(rawText) || !/(去|出行|旅行|出差|计划)/.test(rawText)) {
    return false;
  }
  const segment = segmentMentioning(rawText, /上海|周末|本周末|这周末/).replace(/(本|这)?周末/g, "");
  return !/(周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：)|20\d{2})/.test(
    segment
  );
}

function rawHasExplicitRecentSleepGoal(rawText: string) {
  return /最近|近期|这段时间/.test(rawText) && rawHasRecurringSleepGoal(rawText) && resolveRecurringSleepTarget(rawText).ambiguity === "none";
}

function isRedundantSleepScopeConfirmation(text: string) {
  return /(你要设置的日常目标|是否.*(设置|记录|保存).*睡|日常目标.*对吗|对吗.*睡|睡.*对吗|短期|长期|试一段时间|持续多久|生效范围|范围)/.test(text);
}

function isOpenShanghaiTimeQuestion(text: string) {
  return /上海/.test(text) && /(具体|哪天|几点|什么时候|出发|出行时间)/.test(text);
}

function hasInventedCoarseWeekendTravelDefault(text: string) {
  return /(202\d|20\d{2}|周日|星期日|周天|星期天|下午\s*2\s*点|(?:^|[^\d])2\s*点|14:00|明天中午)/.test(text);
}

function hasInventedMilkReminderDefault(feedbackQuestion: string | undefined, actions: InterpretAction[]) {
  const milkTexts = actions.filter((action) => /牛奶/.test(actionText(action))).map(actionText);
  if (feedbackQuestion && /牛奶/.test(feedbackQuestion)) {
    milkTexts.push(segmentMentioning(feedbackQuestion, /牛奶/));
  }
  return milkTexts.some((text) => /(明天中午|明天.*中午|中午.*牛奶|牛奶.*中午)/.test(text));
}

function rawHasKidsClass(rawText: string) {
  return /(孩子|小孩|儿子|女儿|兴趣班)/.test(rawText) && /兴趣班/.test(rawText);
}

function hasAction(actions: InterpretAction[], type: InterpretAction["type"], pattern: RegExp) {
  return actions.some((action) => action.type === type && pattern.test(actionText(action)));
}

function isSleepGoalTask(action: InterpretAction) {
  return action.type === "add_task" && /(睡觉|上床|入睡|休息)/.test(actionText(action));
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

  if (rawHasRecurringSleepGoal(rawText)) {
    const resolution = resolveRecurringSleepTarget(rawText);
    const hasRoutineGoal = actions.some(
      (action) => action.type === "add_routine_goal" && /(睡觉|睡|上床|休息)/.test(actionText(action))
    );
    if (!hasRoutineGoal) {
      errors.push("原文包含重复睡眠目标，最终 actions 必须用 add_routine_goal 承接每天/每晚的循环语义。");
    }
    const duplicateSleepTasks = actions.filter(
      (action) =>
        isSleepGoalTask(action) &&
        (hasRoutineGoal || /(每天|每日|天天|每晚|daily|every day|every night)/i.test(actionText(action)))
    );
    if (duplicateSleepTasks.length) {
      errors.push("重复睡眠目标不能同时创建 add_routine_goal 和同语义 add_task。");
    }
    if (resolution.ambiguity === "ampm") {
      const sleepRoutineGoals = actions.filter(
        (action): action is Extract<InterpretAction, { type: "add_routine_goal" }> =>
          action.type === "add_routine_goal" && /(睡觉|睡|上床|休息)/.test(actionText(action))
      );
      if (sleepRoutineGoals.some((action) => Boolean(action.targetTime))) {
        errors.push("“每天12点前睡觉”缺少中午/午夜上下文，确认前 routine goal 不应写入具体 targetTime。");
      }
      if (!/(中午|晚上|午夜|半夜|12点|十二点)/.test(combinedText)) {
        errors.push("“每天12点前睡觉”需要在 feedback.question 或 add_check_in 中追问中午/晚上/午夜。");
      }
    }
    if (rawHasExplicitRecentSleepGoal(rawText) && isRedundantSleepScopeConfirmation(combinedText)) {
      errors.push("用户已明确给出“最近”的重复睡眠目标和时间，不应再追问“日常目标是否正确”或“短期/长期”。");
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
    if (rawRequestsShanghaiPrep(rawText) && !hasShanghaiPrepReminder) {
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

  if (rawHasCoarseWeekendShanghaiTrip(rawText)) {
    const shanghaiEvents = actions.filter(
      (action): action is Extract<InterpretAction, { type: "add_life_event" }> =>
        action.type === "add_life_event" && /上海/.test(actionText(action))
    );
    if (!shanghaiEvents.length) {
      errors.push("原文包含本周末去上海安排，最终 actions 缺少上海 life_event。");
    }
    if (shanghaiEvents.some((event) => Boolean(event.startsAt || event.endsAt))) {
      errors.push("用户只说本周末去上海，没有给出具体日期/时间，不能写入 startsAt 或 endsAt。");
    }
    if (hasInventedCoarseWeekendTravelDefault(combinedText)) {
      errors.push("用户只说本周末去上海，反馈或确认问题中不能编造周日下午2点、具体日期或类似默认时间。");
    }
    if (!isOpenShanghaiTimeQuestion(combinedText)) {
      errors.push("本周末去上海缺少具体时间时，需要开放式追问具体是哪天、几点出发。");
    }
  }

  if (rawHasSuzhouTrip(rawText) && !actions.some((action) => /苏州/.test(actionText(action)))) {
    errors.push("原文包含苏州出行安排，但 actions 中没有覆盖苏州相关意图。");
  }

  if (rawRequestsMilk(rawText)) {
    if (!actions.some((action) => /牛奶/.test(actionText(action)))) {
      errors.push("原文包含牛奶购买/下单意图，但 actions 中没有覆盖牛奶。");
    }
    if (!rawHasExplicitMilkReminderTime(rawText)) {
      const milkTimedActions = actions.filter((action) => {
        if (!/牛奶/.test(actionText(action))) return false;
        if (action.type === "add_task") return Boolean(action.dueAt);
        if (action.type === "add_shopping_item") return Boolean(action.dueAt || action.expectedAt);
        return false;
      });
      if (milkTimedActions.length) {
        errors.push("用户没有给出买牛奶的提醒时间，不能为牛奶待办或购物项写入 dueAt/expectedAt。");
      }
      if (hasInventedMilkReminderDefault(feedbackQuestion, actions)) {
        errors.push("用户没有给出买牛奶的提醒时间，反馈或确认问题中不能编造“明天中午”。");
      }
    }
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
