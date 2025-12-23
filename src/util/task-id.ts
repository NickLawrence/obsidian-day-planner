import { propRegexp } from "../regexp";

export const plannerTaskIdKey = "planner-id";

export function extractPlannerTaskId(text: string) {
  const matches = [...text.matchAll(propRegexp)];

  const match = matches.find(([, key]) => key.trim() === plannerTaskIdKey);

  const value = match?.[2];

  return value?.trim();
}
