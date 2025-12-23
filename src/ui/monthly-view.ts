import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, type SvelteComponent, unmount } from "svelte";

import { viewTypeMonthlyCalendar } from "../constants";
import type { ComponentContext } from "../types";

import MonthlyCalendar from "./components/monthly/monthly-calendar.svelte";

export default class MonthlyView extends ItemView {
  navigation = true;
  private calendarComponent?: SvelteComponent;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly componentContext: ComponentContext,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return viewTypeMonthlyCalendar;
  }

  getDisplayText(): string {
    return "Monthly Calendar";
  }

  getIcon() {
    return "calendar-clock";
  }

  async onOpen() {
    const contentEl = this.containerEl.children[1];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.calendarComponent = mount(MonthlyCalendar as any, {
      target: contentEl,
      context: this.componentContext,
    });
  }

  async onClose() {
    if (this.calendarComponent) {
      await unmount(this.calendarComponent);
    }
  }
}
