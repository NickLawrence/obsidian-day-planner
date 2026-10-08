import { dump, load, JSON_SCHEMA } from "js-yaml";
import type { EventRef, Vault } from "obsidian";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlannerData } from "../src/service/planner-data";
import {
  PlannerDataWatcher,
  plannerPollIntervalMs,
} from "../src/service/planner-data-watcher";
import { createActivityRecord } from "../src/shared/activity";
import { createDayPlannerActivityApi } from "../src/util/activity-totals";

vi.mock("obsidian", () => ({
  parseYaml: (data: string) => load(data, { schema: JSON_SCHEMA }),
  stringifyYaml: dump,
}));

const week = "_Planner/activities/2026/2026-W41.yaml";
const olderWeek = "_Planner/activities/2026/2026-W40.yaml";
const goals = "_Planner/goals/2026/2026-W41.yaml";
const record = (note: string) => ({
  ...createActivityRecord("walk", {}, "2026-10-07 10:00:00"),
  notes: note,
});
const activityFile = (note: string) => dump({ activities: [record(note)] });

function fixture(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  // The index and Vault.read deliberately remain stale after a direct adapter write.
  const indexed = new Map(disk);
  const handlers = new Map<
    string,
    Map<EventRef, (file: { path: string }, oldPath?: string) => void>
  >();
  const errors = vi.fn();
  const adapter = {
    exists: async (path: string) =>
      disk.has(path) ||
      [...disk.keys()].some((key) => key.startsWith(`${path}/`)),
    read: vi.fn(async (path: string) => {
      if (!disk.has(path)) throw new Error("File missing");
      return disk.get(path)!;
    }),
    write: async (path: string, contents: string) => {
      disk.set(path, contents);
    },
    list: async (folder: string) => {
      const files: string[] = [];
      const folders = new Set<string>();
      for (const path of disk.keys()) {
        if (!path.startsWith(`${folder}/`)) continue;
        const rest = path.slice(folder.length + 1);
        if (rest.includes("/")) folders.add(`${folder}/${rest.split("/")[0]}`);
        else files.push(path);
      }
      return { files, folders: [...folders] };
    },
  };
  const vault = {
    adapter,
    getFiles: () =>
      [...indexed.keys()].map((path) => ({
        path,
        extension: "yaml",
        stat: { mtime: 1 },
      })),
    getFileByPath: (path: string) => (indexed.has(path) ? { path } : null),
    read: async (file: { path: string }) => indexed.get(file.path)!,
    createFolder: async () => {},
    create: async (path: string, contents: string) => {
      if (disk.has(path)) throw new Error("File already exists");
      disk.set(path, contents);
      indexed.set(path, contents);
      return { path };
    },
    process: async (
      file: { path: string },
      update: (contents: string) => string,
    ) => disk.set(file.path, update(disk.get(file.path)!)),
    on: (
      name: string,
      callback: (file: { path: string }, oldPath?: string) => void,
    ) => {
      const ref = {} as EventRef;
      if (!handlers.has(name)) handlers.set(name, new Map());
      handlers.get(name)!.set(ref, callback);
      return ref;
    },
    offref: (ref: EventRef) => {
      handlers.forEach((listeners) => listeners.delete(ref));
    },
  } as unknown as Vault;
  const planner = new PlannerData(vault);
  const watcher = new PlannerDataWatcher(vault, planner, errors);
  const state = writable(planner.asListProps());
  const changed = vi.fn(() => state.set(planner.asListProps()));
  const unsubscribe = planner.onChange(changed);
  const api = createDayPlannerActivityApi(state);
  const emit = (name: string, path: string, oldPath?: string) => {
    handlers.get(name)?.forEach((callback) => callback({ path }, oldPath));
  };
  return {
    disk,
    indexed,
    adapter,
    vault,
    planner,
    watcher,
    errors,
    changed,
    api,
    emit,
    dispose: () => {
      watcher.stop();
      unsubscribe();
    },
  };
}

describe("planner reloads after sync adapter writes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("refreshes the dashboard/API when sync updates contents without events or an mtime change", async () => {
    const f = fixture({ [week]: activityFile("Before sync") });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.api.getAllActivities()[0].notes).toBe("Before sync");
    f.disk.set(week, activityFile("From remote"));
    expect(await f.vault.read(f.vault.getFileByPath(week)!)).toContain(
      "Before sync",
    );
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs);
    expect(f.api.getAllActivities()[0].notes).toBe("From remote");
    expect(f.changed).toHaveBeenCalledTimes(2);
    // Unchanged periodic checks don't repaint all views.
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs * 2);
    expect(f.changed).toHaveBeenCalledTimes(2);
    f.dispose();
  });

  it("discovers new weekly files and deletions that are absent from the vault index", async () => {
    const f = fixture({ [week]: activityFile("Current") });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    f.disk.set(olderWeek, activityFile("New remote file"));
    f.disk.delete(week);
    expect(f.vault.getFileByPath(olderWeek)).toBeNull();
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs);
    expect(f.api.getAllActivities().map(({ notes }) => notes)).toEqual([
      "New remote file",
    ]);
    expect(Object.keys(f.planner.asListProps())).toEqual([olderWeek]);
    f.disk.delete(olderWeek);
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs);
    expect(f.api.getAllActivities()).toEqual([]);
    f.dispose();
  });

  it("debounces sync bursts and reloads when a folder is renamed outside _Planner", async () => {
    const f = fixture({ [week]: activityFile("Before") });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    const reload = vi.spyOn(f.planner, "loadActivities");
    f.disk.set(week, activityFile("After"));
    for (let i = 0; i < 10; i++) f.emit("modify", week);
    f.emit("modify", "Unrelated.md");
    await vi.advanceTimersByTimeAsync(249);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(f.api.getAllActivities()[0].notes).toBe("After");
    f.disk.delete(week);
    f.emit("rename", "Archive/activities", "_Planner/activities");
    await vi.advanceTimersByTimeAsync(250);
    expect(f.api.getAllActivities()).toEqual([]);
    f.dispose();
  });

  it("notifies goal views and reads synced goals directly from storage", async () => {
    const f = fixture({ [week]: activityFile("Current") });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    f.disk.set(
      goals,
      dump({ entries: [{ activity: "walk", kind: "goal", duration: 30 }] }),
    );
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs);
    expect(f.changed).toHaveBeenCalledTimes(2);
    expect(
      await f.planner.readPlanEntries(window.moment("2026-10-07")),
    ).toEqual([{ activity: "walk", kind: "goal", duration: 30 }]);
    f.dispose();
  });

  it("keeps the last good snapshot during an invalid sync write and recovers without restarting", async () => {
    const f = fixture({ [week]: activityFile("Before") });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    f.disk.set(week, "activities: [unfinished");
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs * 2);
    expect(f.errors).toHaveBeenCalledTimes(1);
    expect(f.api.getAllActivities()[0].notes).toBe("Before");
    f.disk.set(week, activityFile("Recovered"));
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs);
    expect(f.api.getAllActivities()[0].notes).toBe("Recovered");
    f.dispose();
  });

  it("recovers if the initial load failed and refreshes immediately on returning to the app", async () => {
    const f = fixture({ [week]: "activities: [unfinished" });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.errors).toHaveBeenCalledTimes(1);
    f.disk.set(week, activityFile("Valid after sync"));
    await f.watcher.refresh();
    expect(f.api.getAllActivities()[0].notes).toBe("Valid after sync");
    f.dispose();
  });

  it("queues another scan instead of running overlapping reloads during sync", async () => {
    const f = fixture({ [week]: activityFile("Before") });
    await f.planner.loadActivities();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal!: () => void;
    const entered = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const read = f.adapter.read.getMockImplementation()!;
    f.adapter.read.mockImplementationOnce(async (path) => {
      const contents = await read(path);
      signal();
      await paused;
      return contents;
    });
    const first = f.planner.loadActivities();
    await entered;
    f.disk.set(week, activityFile("Latest sync result"));
    const second = f.planner.loadActivities();
    expect(second).toBe(first);
    release();
    await second;
    expect(f.api.getAllActivities()[0].notes).toBe("Latest sync result");
    f.dispose();
  });

  it("can finish a newly synced activity before the file has been indexed", async () => {
    const f = fixture();
    f.disk.set(week, activityFile("Remote note"));
    await f.planner.loadActivities();
    await f.planner.updateActivities(week, (records) =>
      records.with(0, {
        ...records[0],
        log: [{ ...records[0].log![0], end: "2026-10-07 10:30:00" }],
      }),
    );
    expect(f.api.getAllActivities()[0].notes).toBe("Remote note");
    expect(f.api.getAllActivities()[0].log![0].end).toBe("2026-10-07 10:30:00");
    f.dispose();
  });

  it("cleans up polling and events and cannot start after plugin unload", async () => {
    const f = fixture({ [week]: activityFile("Before") });
    f.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    const reload = vi.spyOn(f.planner, "loadActivities");
    f.emit("modify", week);
    f.dispose();
    f.watcher.start();
    f.emit("modify", week);
    await f.watcher.refresh();
    await vi.advanceTimersByTimeAsync(plannerPollIntervalMs * 2);
    expect(reload).not.toHaveBeenCalled();
  });
});
