import type { InterpretAction } from "@/lib/ai/interpretation";

export function uniqueRef(actions: InterpretAction[], base: string) {
  const refs = new Set(actions.flatMap((action) => ("ref" in action && action.ref ? [action.ref] : [])));
  if (!refs.has(base)) return base;
  let index = 2;
  while (refs.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function ensureActionRef(actions: InterpretAction[], index: number, base: string) {
  const action = actions[index];
  if (
    !action ||
    (action.type !== "add_task" &&
      action.type !== "add_life_event" &&
      action.type !== "add_shopping_item" &&
      action.type !== "add_routine_goal")
  ) {
    return { actions, ref: undefined };
  }
  if (action.ref) return { actions, ref: action.ref };

  const ref = uniqueRef(actions, base);
  return {
    actions: actions.map((item, itemIndex) => (itemIndex === index ? ({ ...item, ref } as InterpretAction) : item)),
    ref
  };
}

export function actionRefs(actions: InterpretAction[]) {
  return new Set(actions.flatMap((action) => ("ref" in action && action.ref ? [action.ref] : [])));
}
