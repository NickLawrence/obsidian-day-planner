import type { Duration as MomentDuration } from "moment";
import type { App, TFile } from "obsidian";

import {
  getActivityLabel,
  normalizeActivityName,
} from "./activity-definitions";

export type ActivityGoal = {
  activity: string;
  goal: MomentDuration;
};

export type ActivityPlanEntryKind = "goal" | "estimate";

export type ActivityPlanEntry = {
  activity: string;
  kind: ActivityPlanEntryKind;
  duration: MomentDuration;
  sourceLine?: number;
};

type ActivityPlanSection = {
  headingLineIndex: number;
  insertLineIndex: number;
  lines: string[];
};

const activityGoalsHeading = "Activity goals";

function getHeadingInfo(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;

  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

function findActivityPlanSection(
  markdown: string,
  heading = activityGoalsHeading,
): ActivityPlanSection | null {
  const lines = markdown.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const headingInfo = getHeadingInfo(lines[index]);
    if (
      !headingInfo ||
      headingInfo.text.localeCompare(heading, undefined, {
        sensitivity: "base",
      }) !== 0
    ) {
      continue;
    }

    let insertLineIndex = lines.length;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextHeadingInfo = getHeadingInfo(lines[nextIndex]);
      if (nextHeadingInfo) {
        insertLineIndex = nextIndex;
        break;
      }
    }

    return { headingLineIndex: index, insertLineIndex, lines };
  }

  return null;
}

function formatPlanLine(entry: {
  activity: string;
  kind: ActivityPlanEntryKind;
  duration: MomentDuration;
}) {
  const minutes = Math.max(0, Math.round(entry.duration.asMinutes()));
  return `- (activity:: ${sanitizeLabel(entry.activity)}) (${entry.kind}:: ${minutes} mins)`;
}

export function upsertActivityPlanEntryInMarkdown(
  markdown: string,
  entry: {
    activity: string;
    kind: ActivityPlanEntryKind;
    duration: MomentDuration;
    sourceLine?: number;
  },
  heading = activityGoalsHeading,
) {
  const nextLine = formatPlanLine(entry);
  const section = findActivityPlanSection(markdown, heading);

  if (!section) {
    const separator =
      markdown.trim().length > 0 && !markdown.endsWith("\n") ? "\n\n" : "";
    const prefix = `${markdown}${separator}# Activity Goals\n`;
    return {
      markdown: `${prefix}${nextLine}\n`,
      lineIndex: prefix.split("\n").length - 1,
    };
  }

  if (
    typeof entry.sourceLine === "number" &&
    entry.sourceLine > section.headingLineIndex &&
    entry.sourceLine < section.insertLineIndex &&
    section.lines[entry.sourceLine] !== undefined
  ) {
    const indent = section.lines[entry.sourceLine].match(/^\s*/)?.[0] ?? "";
    section.lines[entry.sourceLine] = `${indent}${nextLine}`;
    return { markdown: section.lines.join("\n"), lineIndex: entry.sourceLine };
  }

  section.lines.splice(section.insertLineIndex, 0, nextLine);
  return {
    markdown: section.lines.join("\n"),
    lineIndex: section.insertLineIndex,
  };
}

type AppWithDataviewPlugin = App & {
  plugins?: {
    plugins?: {
      dataview?: {
        api?: DataviewApi;
      };
    };
  };
};

export function getDataviewApi(app: App): DataviewApi | null {
  return (app as AppWithDataviewPlugin).plugins?.plugins?.dataview?.api ?? null;
}

function sanitizeLabel(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function toMomentDuration(luxonDuration: unknown): MomentDuration | null {
  // Assume Dataview already parsed the value into a Luxon Duration.
  if (!luxonDuration || typeof luxonDuration !== "object") return null;

  const asFn = (luxonDuration as { as?: unknown }).as;
  if (typeof asFn !== "function") return null;

  const ms = Number(asFn.call(luxonDuration, "milliseconds"));
  if (!Number.isFinite(ms) || ms === 0) return null;

  return window.moment.duration(ms);
}

type DataviewListItem = {
  fields?: Map<string, unknown> | Record<string, unknown>;
  section?: unknown;
  position?: {
    start?: {
      line?: number;
    };
  };
  line?: number;
  [key: string]: unknown;
};

type DataviewPage = {
  file?: {
    lists?: DataviewListItem[];
  };
};

type DataviewApi = {
  page: (path: string) => DataviewPage | null | undefined;
  index?: { initialized?: boolean };
  func?: { meta?: (link: unknown) => { subpath?: string | null } };
};

function getHeadingFromSection(dv: DataviewApi, sectionLink: unknown): string {
  const viaFunc = dv.func?.meta?.(sectionLink)?.subpath;
  if (typeof viaFunc === "string") return viaFunc.trim();

  const direct =
    sectionLink && typeof sectionLink === "object"
      ? (sectionLink as { subpath?: unknown }).subpath
      : undefined;
  if (typeof direct === "string") return direct.trim();

  return "";
}

function getField(item: DataviewListItem, key: string): unknown {
  // Many DV list items surface fields directly: item.activity / item.goal
  if (item && key in item) return item[key];

  const fields = item?.fields;
  if (fields instanceof Map) return fields.get(key);

  if (fields && typeof fields === "object") return fields[key];

  return undefined;
}

function getLineIndex(item: DataviewListItem): number | undefined {
  const positionLine = item.position?.start?.line;
  if (typeof positionLine === "number") return positionLine;

  return typeof item.line === "number" ? item.line : undefined;
}

function getActivityListItems(
  app: App,
  file: TFile,
  heading = activityGoalsHeading,
) {
  const dv = getDataviewApi(app);
  if (!dv) return [];

  if (dv.index?.initialized === false) return [];

  const page = dv.page(file.path);
  const lists = page?.file?.lists ?? [];

  return lists.filter((item) => {
    const sectionHeading = getHeadingFromSection(dv, item?.section);
    return (
      sectionHeading.localeCompare(heading, undefined, {
        sensitivity: "base",
      }) === 0
    );
  });
}

export function extractActivityPlanEntries(
  app: App,
  file: TFile,
  heading = activityGoalsHeading,
): ActivityPlanEntry[] {
  const entries = new Map<string, ActivityPlanEntry>();

  for (const item of getActivityListItems(app, file, heading)) {
    const activityRaw = getField(item, "activity");
    const goalRaw = getField(item, "goal");
    const estimateRaw = getField(item, "estimate");
    const durationRaw = goalRaw ?? estimateRaw;
    const kind = goalRaw ? "goal" : "estimate";

    if (!activityRaw || !durationRaw) continue;

    const activity = sanitizeLabel(String(activityRaw));
    const duration = toMomentDuration(durationRaw);

    if (!activity || !duration) continue;

    entries.set(normalizeActivityName(activity), {
      activity,
      duration,
      kind,
      sourceLine: getLineIndex(item),
    });
  }

  return [...entries.values()];
}

export function extractActivityGoals(
  app: App,
  file: TFile,
  heading = activityGoalsHeading,
): ActivityGoal[] {
  const goals = new Map<string, ActivityGoal>();

  for (const item of getActivityListItems(app, file, heading)) {
    const activityRaw = getField(item, "activity");
    const goalRaw = getField(item, "goal");

    if (!activityRaw || !goalRaw) continue;

    const activity = sanitizeLabel(String(activityRaw));
    const goal = toMomentDuration(goalRaw);

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
