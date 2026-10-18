import type { EventRef, Vault } from "obsidian";

import type { PlannerData } from "./planner-data";

export const plannerPollIntervalMs = 30_000;
const eventDelayMs = 250;

/** Targeted vault events are fast; occasional scans also catch silent sync writes. */
export class PlannerDataWatcher {
  private started = false;
  private stopped = false;
  private events: EventRef[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private debounce?: ReturnType<typeof setTimeout>;
  private reloading?: Promise<void>;
  private pending = false;
  private fullReload = false;
  private paths = new Set<string>();
  private eventPaths = new Set<string>();
  private fullEventReload = false;
  private lastError?: string;

  constructor(
    private readonly vault: Vault,
    private readonly plannerData: Pick<
      PlannerData,
      "loadActivities" | "isDataPath"
    >,
    private readonly onError: (error: unknown) => void,
  ) {}

  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    const changed = (path: string, oldPath?: string) => {
      const paths = [path, oldPath].filter(
        (value): value is string =>
          Boolean(value) && this.plannerData.isDataPath(value!),
      );
      if (!paths.length) return;
      for (const value of paths) {
        if (value.endsWith(".yaml")) this.eventPaths.add(value);
        else this.fullEventReload = true; // Folder changes need discovery/deletion of descendants.
      }
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        const paths = this.fullEventReload ? undefined : [...this.eventPaths];
        this.fullEventReload = false;
        this.eventPaths.clear();
        void this.refresh(paths);
      }, eventDelayMs);
    };
    this.events = [
      this.vault.on("modify", (file) => changed(file.path)),
      this.vault.on("create", (file) => changed(file.path)),
      this.vault.on("delete", (file) => changed(file.path)),
      this.vault.on("rename", (file, oldPath) => changed(file.path, oldPath)),
    ];
    void this.refresh().finally(() => this.schedulePoll());
  }

  private schedulePoll() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().finally(() => this.schedulePoll());
    }, plannerPollIntervalMs);
  }

  refresh(paths?: Iterable<string>): Promise<void> {
    if (!this.started || this.stopped) return Promise.resolve();
    this.pending = true;
    if (paths) for (const path of paths) this.paths.add(path);
    else this.fullReload = true;
    if (!this.reloading)
      this.reloading = this.reload().finally(() => {
        this.reloading = undefined;
      });
    return this.reloading;
  }

  private async reload() {
    while (this.pending && !this.stopped) {
      this.pending = false;
      const paths = this.fullReload ? undefined : [...this.paths];
      this.fullReload = false;
      this.paths.clear();
      try {
        await this.plannerData.loadActivities(paths);
        this.lastError = undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.lastError) {
          this.lastError = message;
          this.onError(error);
        }
      }
    }
  }

  stop() {
    this.stopped = true;
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.events.forEach((event) => this.vault.offref(event));
    this.events = [];
  }
}
