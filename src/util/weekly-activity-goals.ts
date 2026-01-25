import type { App, TFile } from "obsidian";
import type { Duration as MomentDuration } from "moment";

import { getActivityLabel, normalizeActivityName } from "./activity-definitions";

export type ActivityGoal = {
  activity: string;
  goal: MomentDuration;
};

function getDataviewApi(app: App): DataviewApi | null {
  return ((app as any)?.plugins?.plugins?.dataview?.api as DataviewApi) ?? null;
}

function sanitizeLabel(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function toMomentDuration(luxonDuration: any): MomentDuration | null {
  // Assume Dataview already parsed the value into a Luxon Duration.
  const asFn = luxonDuration?.as;
  if (typeof asFn !== "function") return null;

  const ms = Number(luxonDuration.as("milliseconds"));
  if (!Number.isFinite(ms) || ms === 0) return null;

  return window.moment.duration(ms);
}

type DataviewApi = {
  page: (path: string) => any;
  index?: { initialized?: boolean };
  func?: { meta?: (link: any) => { subpath?: string | null } };
};

function getHeadingFromSection(dv: DataviewApi, sectionLink: any): string {
  // Prefer dv.func.meta(section).subpath (Dataview’s documented way). :contentReference[oaicite:5]{index=5}
  const viaFunc = dv.func?.meta?.(sectionLink)?.subpath;
  if (typeof viaFunc === "string") return viaFunc.trim();

  // Fallback if the link object already has a subpath
  const direct = sectionLink?.subpath;
  if (typeof direct === "string") return direct.trim();

  return "";
}

function getField(item: any, key: string): any {
  // Many DV list items surface fields directly: item.activity / item.goal
  if (item && key in item) return item[key];

  const fields = item?.fields;
  if (fields instanceof Map) return fields.get(key);

  if (fields && typeof fields === "object") return (fields as any)[key];

  return undefined;
}

export function extractActivityGoals(
  app: App,
  file: TFile,
  heading = "Activity goals",
): ActivityGoal[] {
  const dv = getDataviewApi(app) as DataviewApi | null;
  if (!dv) return [];

  // Don’t trust DV results until the index is ready. :contentReference[oaicite:6]{index=6}
  if (dv.index?.initialized === false) return [];

  const page = dv.page(file.path);
  const lists: any[] = page?.file?.lists ?? [];

  const goals = new Map<string, ActivityGoal>();

  for (const item of lists) {
    const sectionHeading = getHeadingFromSection(dv, item?.section);
    if (
      sectionHeading.localeCompare(heading, undefined, { sensitivity: "base" }) !== 0
    ) {
      continue;
    }

    const activityRaw = getField(item, "activity");
    const goalRaw = getField(item, "goal");

    if (!activityRaw || !goalRaw) continue;

    const activity = sanitizeLabel(String(activityRaw));
    const goal = toMomentDuration(goalRaw); // expects Luxon Duration already

    if (!activity || !goal) continue;

    goals.set(normalizeActivityName(activity), { activity, goal });
  }

  return [...goals.values()];
}

export function mergeActivityDurationsWithGoals<
  T extends { activity: string; activityKey?: string },
>(
  activityDurations: Array<T & { duration: MomentDuration }>,
  goals: ActivityGoal[],
) {
  const normalizedGoals = new Map(
    goals.map((goal) => [normalizeActivityName(goal.activity), goal] as const),
  );

  const combined = activityDurations.map((entry) => {
    const normalized = entry.activityKey
      ? normalizeActivityName(entry.activityKey)
      : normalizeActivityName(entry.activity);
    const goal = normalizedGoals.get(normalized);

    if (goal) normalizedGoals.delete(normalized);

    return { ...entry, goal: goal?.goal };
  });

  const remainingGoals = [...normalizedGoals.values()].map((goal) => ({
    activity: getActivityLabel(goal.activity),
    activityKey: normalizeActivityName(goal.activity),
    duration: window.moment.duration(0),
    goal: goal.goal,
  }));

  return [...combined, ...remainingGoals].sort((a, b) =>
    a.activity.localeCompare(b.activity, undefined, { sensitivity: "base" }),
  );
}
