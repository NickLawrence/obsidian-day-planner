import type { Moment } from "moment";
import { normalizePath, parseYaml, stringifyYaml, type Vault } from "obsidian";
import { z } from "zod";

import type { PathToListProps } from "../redux/dataview/dataview-slice";
import { propsSchema, type Activity } from "../util/props";

import { normalizeActivities } from "./list-props-parser";

export const plannerFolder = "_Planner";
export const activitiesFolder = `${plannerFolder}/activities`;
export const goalsFolder = `${plannerFolder}/goals`;

export type ActivityPlanEntryKind = "goal" | "estimate";
export type StoredActivityPlanEntry = {
  activity: string;
  kind: ActivityPlanEntryKind;
  duration: number;
};

const planEntrySchema = z.object({
  activity: z.string().trim().min(1),
  kind: z.enum(["goal", "estimate"]),
  duration: z.number().finite().nonnegative(),
});
const planFileSchema = z.object({ entries: z.array(planEntrySchema) });

function weekKey(date: Moment) {
  return `${date.isoWeekYear()}-W${String(date.isoWeek()).padStart(2, "0")}`;
}

function weeklyPath(folder: string, date: Moment) {
  const key = weekKey(date);
  return normalizePath(`${folder}/${date.isoWeekYear()}/${key}.yaml`);
}

export function activitiesPathFor(date: Moment) {
  return weeklyPath(activitiesFolder, date);
}

export function goalsPathFor(date: Moment) {
  return weeklyPath(goalsFolder, date);
}

function activityStart(activity: Activity) {
  const starts = (activity.log ?? []).map(({ start }) =>
    window.moment(start, window.moment.ISO_8601, true),
  );
  if (starts.length === 0 || starts.some((start) => !start.isValid())) {
    throw new Error(`Activity "${activity.activity}" has no valid start time`);
  }
  return starts.reduce((earliest, start) =>
    start.isBefore(earliest) ? start : earliest,
  );
}

function serializeActivities(activities: Activity[]) {
  return stringifyYaml({
    activities: activities.map(({ taskIds, ...activity }) => ({
      ...activity,
      ...(taskIds.length > 0 ? { taskIds } : {}),
    })),
  });
}

async function ensureParentFolders(vault: Vault, path: string) {
  const parts = path.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!vault.getAbstractFileByPath(current))
      await vault.createFolder(current);
  }
}

export class PlannerData {
  private activitiesByPath = new Map<string, Activity[]>();
  private listeners = new Set<() => void>();

  constructor(private readonly vault: Vault) {}

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  isDataPath(path: string) {
    return (
      path.startsWith(`${activitiesFolder}/`) ||
      path.startsWith(`${goalsFolder}/`)
    );
  }

  async loadActivities() {
    const next = new Map<string, Activity[]>();
    for (const file of this.vault.getFiles()) {
      if (file.extension !== "yaml") continue;
      if (file.path.startsWith(`${activitiesFolder}/`)) {
        const props = propsSchema.parse(
          normalizeActivities(parseYaml(await this.vault.read(file))),
        );
        const activities = props.activities ?? [];
        activities.forEach(activityStart);
        next.set(file.path, activities);
      } else if (file.path.startsWith(`${goalsFolder}/`)) {
        planFileSchema.parse(parseYaml(await this.vault.read(file)));
      }
    }
    this.activitiesByPath = next;
    this.changed();
  }

  asListProps(): PathToListProps {
    return Object.fromEntries(
      [...this.activitiesByPath].map(([path, activities]) => [
        path,
        {
          0: {
            parsed: { activities },
            position: {
              start: { line: 0, col: 0, offset: 0 },
              end: { line: 0, col: 0, offset: 0 },
            },
          },
        },
      ]),
    );
  }

  getAllActivities() {
    return [...this.activitiesByPath.values()].flat();
  }

  getOpenActivities() {
    return this.getActivitiesWithLocations().filter(({ activity }) =>
      activity.log?.some((entry) => !entry.end),
    );
  }

  getActivitiesWithLocations() {
    return [...this.activitiesByPath].flatMap(([path, activities]) =>
      activities.flatMap((activity, activityIndex) => [
        { path, activity, activityIndex },
      ]),
    );
  }

  async addActivity(activity: Activity) {
    const path = activitiesPathFor(activityStart(activity));
    await this.updateActivities(path, (activities) => [
      ...activities,
      activity,
    ]);
  }

  async updateActivities(
    path: string,
    update: (activities: Activity[]) => Activity[],
  ) {
    const activities =
      propsSchema.parse({
        activities: update(this.activitiesByPath.get(path) ?? []),
      }).activities ?? [];
    activities.forEach(activityStart);
    const staying: Activity[] = [];
    const moved = new Map<string, Activity[]>();
    for (const activity of activities) {
      const destination = activitiesPathFor(activityStart(activity));
      if (destination === path) staying.push(activity);
      else
        moved.set(destination, [...(moved.get(destination) ?? []), activity]);
    }
    await this.writeActivities(path, staying);
    this.activitiesByPath.set(path, staying);
    for (const [destination, movedActivities] of moved) {
      const combined = [
        ...(this.activitiesByPath.get(destination) ?? []),
        ...movedActivities,
      ];
      await this.writeActivities(destination, combined);
      this.activitiesByPath.set(destination, combined);
    }
    this.changed();
  }

  private async writeActivities(path: string, activities: Activity[]) {
    await ensureParentFolders(this.vault, path);
    const contents = serializeActivities(activities);
    const file = this.vault.getFileByPath(path);
    if (file) await this.vault.modify(file, contents);
    else await this.vault.create(path, contents);
  }

  async readPlanEntries(week: Moment): Promise<StoredActivityPlanEntry[]> {
    const file = this.vault.getFileByPath(goalsPathFor(week));
    if (!file) return [];
    return planFileSchema.parse(parseYaml(await this.vault.read(file))).entries;
  }

  async upsertPlanEntry(week: Moment, entry: StoredActivityPlanEntry) {
    const path = goalsPathFor(week);
    const entries = await this.readPlanEntries(week);
    const normalized = entry.activity.trim().toLowerCase();
    const index = entries.findIndex(
      (item) => item.activity.trim().toLowerCase() === normalized,
    );
    const updated =
      index === -1 ? [...entries, entry] : entries.with(index, entry);
    await ensureParentFolders(this.vault, path);
    const contents = stringifyYaml({ entries: updated });
    const file = this.vault.getFileByPath(path);
    if (file) await this.vault.modify(file, contents);
    else await this.vault.create(path, contents);
    this.changed();
  }

  async createOrOpenGoalsFile(week: Moment) {
    const path = goalsPathFor(week);
    let file = this.vault.getFileByPath(path);
    if (!file) {
      await ensureParentFolders(this.vault, path);
      file = await this.vault.create(path, stringifyYaml({ entries: [] }));
    }
    return file;
  }
}
