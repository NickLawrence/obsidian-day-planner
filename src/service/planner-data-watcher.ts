import type { EventRef, Vault } from "obsidian";

import type { PlannerData } from "./planner-data";

export const plannerPollIntervalMs = 5_000;
const eventDelayMs = 250;

/** Vault events are fast; adapter scans also catch changes made by sync plugins. */
export class PlannerDataWatcher {
  private started = false;
  private stopped = false;
  private events: EventRef[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private reloading?: Promise<void>;
  private pending = false;
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
      if (
        !this.plannerData.isDataPath(path) &&
        (!oldPath || !this.plannerData.isDataPath(oldPath))
      )
        return;
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        void this.refresh();
      }, eventDelayMs);
    };
    this.events = [
      this.vault.on("modify", (file) => changed(file.path)),
      this.vault.on("create", (file) => changed(file.path)),
      this.vault.on("delete", (file) => changed(file.path)),
      this.vault.on("rename", (file, oldPath) => changed(file.path, oldPath)),
    ];
    this.timer = setInterval(() => {
      void this.refresh();
    }, plannerPollIntervalMs);
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (!this.started || this.stopped) return Promise.resolve();
    this.pending = true;
    if (!this.reloading)
      this.reloading = this.reload().finally(() => {
        this.reloading = undefined;
      });
    return this.reloading;
  }

  private async reload() {
    while (this.pending && !this.stopped) {
      this.pending = false;
      try {
        await this.plannerData.loadActivities();
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
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.events.forEach((event) => this.vault.offref(event));
    this.events = [];
  }
}
