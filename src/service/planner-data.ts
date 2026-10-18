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
  private fileContents?: Map<string, string>;
  private loading?: Promise<void>;
  private fullReloadRequested = false;
  private dirtyPaths = new Set<string>();
  private activitySnapshot: Activity[] = [];
  private listPropsSnapshot?: PathToListProps;

  constructor(private readonly vault: Vault) {}

  private createRepository(writtenPaths: Set<string>) {
    const vault = this.vault;
    return new ActivityRepository(
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
          writtenPaths.add(path);
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

  private async readDataFile(path: string, listed = false) {
    if (!listed && !(await this.vault.adapter.exists(path))) return null;
    try {
      return await this.vault.adapter.read(path);
    } catch (error) {
      // A sync deletion can race a directory scan. Do not hide read timeouts.
      if (!(await this.vault.adapter.exists(path))) return null;
      throw error;
    }
  }

  /** Known file changes reload only those paths; full scans also discover silent sync writes. */
  loadActivities(paths?: Iterable<string>): Promise<void> {
    if (paths && this.fileContents) {
      for (const path of paths) this.dirtyPaths.add(path);
    } else {
      this.fullReloadRequested = true;
    }
    if (!this.loading) {
      this.loading = this.reloadActivities().finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  private async reloadActivities() {
    while (this.fullReloadRequested || this.dirtyPaths.size) {
      const paths = this.fullReloadRequested ? undefined : [...this.dirtyPaths];
      this.fullReloadRequested = false;
      this.dirtyPaths.clear();
      await this.readActivitiesSnapshot(paths);
    }
  }

  private async readActivitiesSnapshot(changedPaths?: string[]) {
    const paths = changedPaths ?? (await this.listDataFiles());
    const reads = new Array<string | null>(paths.length);
    let nextIndex = 0;
    let readFailed = false;
    let readError: unknown;
    // Bound parallel I/O: a long vault history should neither serialize every
    // read nor flood Obsidian's filesystem adapter with hundreds of requests.
    await Promise.all(
      Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (!readFailed && nextIndex < paths.length) {
          const index = nextIndex++;
          try {
            reads[index] = await this.readDataFile(
              paths[index],
              changedPaths === undefined,
            );
          } catch (error) {
            if (!readFailed) readError = error;
            readFailed = true;
          }
        }
      }),
    );
    if (readFailed) throw readError;
    const contents = changedPaths
      ? new Map(this.fileContents)
      : new Map<string, string>();
    paths.forEach((path, index) => {
      const data = reads[index];
      if (data === null) contents.delete(path);
      else contents.set(path, data);
    });
    const previous = this.fileContents;
    if (
      previous &&
      contents.size === previous.size &&
      [...contents].every(([path, data]) => previous.get(path) === data)
    )
      return;
    const next = new Map(this.activitiesByPath);
    let activitiesChanged = false;
    for (const path of new Set([
      ...(previous?.keys() ?? []),
      ...contents.keys(),
    ])) {
      const data = contents.get(path);
      if (previous?.get(path) === data) continue;
      if (path.startsWith(`${activitiesFolder}/`)) {
        activitiesChanged = true;
        if (data === undefined) next.delete(path);
        else
          next.set(
            path,
            readStoredActivities([[path, data]], activityYaml).map(
              ({ record }) => record,
            ),
          );
      } else if (data !== undefined && path.startsWith(`${goalsFolder}/`)) {
        planFileSchema.parse(parseYaml(data));
      }
    }
    // Publish only after every changed file validates, retaining the last good
    // snapshot if sync temporarily leaves an incomplete YAML file.
    if (activitiesChanged) {
      this.activitiesByPath = new Map(
        [...next].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
      this.activitySnapshot = [...this.activitiesByPath.values()].flat();
      this.listPropsSnapshot = undefined;
    }
    this.fileContents = contents;
    this.changed();
  }

  asListProps(): PathToListProps {
    if (this.listPropsSnapshot) return this.listPropsSnapshot;
    this.listPropsSnapshot = Object.fromEntries(
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
    return this.listPropsSnapshot;
  }

  /** Stable read-only snapshot, replaced after a validated activity-file change. */
  getAllActivities() {
    return this.activitySnapshot;
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
    const writtenPaths = new Set<string>();
    await this.createRepository(writtenPaths).addActivity(activity);
    await this.loadActivities(writtenPaths);
  }

  async updateActivities(
    path: string,
    update: (activities: Activity[]) => Activity[],
  ) {
    const visible = this.activitiesByPath.get(path) ?? [];
    const writtenPaths = new Set<string>();
    await this.createRepository(writtenPaths).updateActivities(
      path,
      (latest) => {
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
      },
    );
    await this.loadActivities(writtenPaths);
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
    await this.loadActivities([path]);
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
