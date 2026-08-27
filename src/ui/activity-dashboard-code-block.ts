import {
  MarkdownRenderChild,
  type App,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { mount, type SvelteComponent, unmount } from "svelte";

import type { DayPlannerActivityApi } from "../util/activity-totals";

import ActivityDashboard from "./components/activity-dashboard.svelte";

class ActivityDashboardChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly component: SvelteComponent,
  ) {
    super(containerEl);
  }

  override async onunload() {
    await unmount(this.component);
  }
}

export function renderActivityDashboardCodeBlock(props: {
  app: App;
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
  activityApi: DayPlannerActivityApi;
}) {
  const { app, el, ctx, activityApi } = props;
  el.empty();
  el.addClass("day-planner-activity-dashboard-code-block");

  const component = mount(ActivityDashboard as never, {
    target: el,
    props: { app, activityApi },
  });
  ctx.addChild(
    new ActivityDashboardChild(el, component as unknown as SvelteComponent),
  );
}
