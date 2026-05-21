import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";

import { viewTypeActivityQueue } from "../constants";
import type { ComponentContext } from "../types";

import ActivityQueuePanel from "./components/activity-queue-panel.svelte";

export class ActivityQueueView extends ItemView {
  private panel?: Component;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly componentContext: ComponentContext,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return viewTypeActivityQueue;
  }

  getDisplayText(): string {
    return "Activity Queue";
  }

  getIcon() {
    return "star-list";
  }

  async onOpen() {
    const contentEl = this.containerEl.children[1];
    contentEl.addClass("planner-flex-container");

    // @ts-expect-error
    this.panel = mount(ActivityQueuePanel, {
      target: contentEl,
      context: this.componentContext,
    });
  }

  async onClose() {
    if (this.panel) {
      await unmount(this.panel);
    }
  }
}
