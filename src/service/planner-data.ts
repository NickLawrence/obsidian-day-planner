import type { Moment } from "moment";
import { parseYaml, stringifyYaml, type Vault } from "obsidian";
import { z } from "zod";

import type { PathToListProps } from "../redux/dataview/dataview-slice";
import {
  activitiesFolder,
  plannerFolder,
  goalsFolder,
  goalsPathFor,
  hasOpenActivityClock,
  ActivityRepository,
  storedActivityId,
  readStoredActivities,
} from "../shared/activity";
import type { Activity } from "../util/props";

export {
  plannerFolder,
  activitiesFolder,
  goalsFolder,
  activitiesPathFor,
  goalsPathFor,
} from "../shared/activity";
const activityYaml = { parse: parseYaml, stringify: stringifyYaml };

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

async function ensureParentFolders(vault: Vault, path: string) {
  const parts = path.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await vault.adapter.exists(current)))
      await vault.createFolder(current);
  }
}

export class PlannerData {
  private activitiesByPath = new Map<string, Activity[]>();
  private listeners = new Set<() => void>();
  private readonly repository: ActivityRepository;
  private fileContents?: Map<string, string>;
  private loading?: Promise<void>;
  private reloadRequested = false;

  constructor(private readonly vault: Vault) {
    this.repository = new ActivityRepository(
      {
        listFiles: () => this.listDataFiles(),
        readFile: (path) => this.readDataFile(path),
        writeFile: async (path, contents, expected) => {
          await ensureParentFolders(vault, path);
          const file = vault.getFileByPath(path);
          if (file) {
            await vault.process(file, (current) => {
              if (current !== expected)
                throw new Error(
                  "The activity file changed. Refresh and try again.",
                );
              return contents;
            });
          } else {
            const current = await this.readDataFile(path);
            if (current !== expected)
              throw new Error(
                "The activity file changed. Refresh and try again.",
              );
            // Sync can create a YAML file before Obsidian indexes it as a TFile.
            if (current !== null) await vault.adapter.write(path, contents);
            else await vault.create(path, contents);
          }
        },
      },
      activityYaml,
    );
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  isDataPath(path: string) {
    return (
      path === plannerFolder ||
      path === activitiesFolder ||
      path === goalsFolder ||
      path.startsWith(`${activitiesFolder}/`) ||
      path.startsWith(`${goalsFolder}/`)
    );
  }

  private async listDataFiles() {
    const files: string[] = [];
    const visit = async (folder: string) => {
      if (!(await this.vault.adapter.exists(folder))) return;
      const children = await this.vault.adapter.list(folder);
      files.push(...children.files.filter((path) => path.endsWith(".yaml")));
      for (const child of children.folders) await visit(child);
    };
    await visit(activitiesFolder);
    await visit(goalsFolder);
    return files.sort();
  }

  private async readDataFile(path: string) {
    return (await this.vault.adapter.exists(path))
      ? this.vault.adapter.read(path)
      : null;
  }

  loadActivities(): Promise<void> {
    this.reloadRequested = true;
    if (!this.loading) {
      this.loading = this.reloadActivities().finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  private async reloadActivities() {
    while (this.reloadRequested) {
      this.reloadRequested = false;
      await this.readActivitiesSnapshot();
    }
  }

  private async readActivitiesSnapshot() {
    const contents = new Map<string, string>();
    for (const path of await this.listDataFiles()) {
      const data = await this.readDataFile(path);
      if (data !== null) contents.set(path, data);
    }
    if (
      this.fileContents &&
      contents.size === this.fileContents.size &&
      [...contents].every(
        ([path, data]) => this.fileContents!.get(path) === data,
      )
    )
      return;
    const next = new Map<string, Activity[]>();
    for (const { path, record } of readStoredActivities(contents, activityYaml))
      next.set(path, [...(next.get(path) ?? []), record]);
    for (const [path, data] of contents) {
      if (path.startsWith(`${goalsFolder}/`)) {
        planFileSchema.parse(parseYaml(data));
      }
    }
    this.activitiesByPath = next;
    this.fileContents = contents;
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
      hasOpenActivityClock(activity),
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
    await this.repository.addActivity(activity);
    await this.loadActivities();
  }

  async updateActivities(
    path: string,
    update: (activities: Activity[]) => Activity[],
  ) {
    const visible = this.activitiesByPath.get(path) ?? [];
    await this.repository.updateActivities(path, (latest) => {
      if (
        visible.some(
          (record, index) =>
            !latest[index] ||
            storedActivityId(path, record) !==
              storedActivityId(path, latest[index]),
        )
      )
        throw new Error("The activity list changed. Refresh and try again.");
      return update(latest);
    });
    await this.loadActivities();
  }

  async readPlanEntries(week: Moment): Promise<StoredActivityPlanEntry[]> {
    const contents = await this.readDataFile(goalsPathFor(week));
    if (contents === null) return [];
    return planFileSchema.parse(parseYaml(contents)).entries;
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
    else if (await this.vault.adapter.exists(path))
      await this.vault.adapter.write(path, contents);
    else await this.vault.create(path, contents);
    await this.loadActivities();
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
