import type { InterpretAction } from "@/lib/ai/interpretation";

export function actionText(action: InterpretAction) {
  if (action.type === "add_task") return [action.title, action.description].filter(Boolean).join(" ");
  if (action.type === "add_life_event") return [action.title, action.description, action.location].filter(Boolean).join(" ");
  if (action.type === "add_check_in") return [action.title, action.question].join(" ");
  if (action.type === "add_shopping_item") return action.itemName;
  if (action.type === "update_shopping_status") return action.itemName;
  if (action.type === "mark_task_done") return action.matchTitle;
  return "";
}
