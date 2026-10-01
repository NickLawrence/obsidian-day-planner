import {
  MarkdownRenderChild,
  type App,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { mount, type SvelteComponent, unmount } from "svelte";

import type { PeriodicNotes } from "../service/periodic-notes";
import type { PlannerData } from "../service/planner-data";
import type { DayPlannerActivityApi } from "../util/activity-totals";

import ActivityGoals from "./components/activity-goals.svelte";

class ActivityGoalsChild extends MarkdownRenderChild {
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

export function renderActivityGoalsCodeBlock(props: {
  app: App;
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
  periodicNotes: PeriodicNotes;
  plannerData: PlannerData;
  activityApi: DayPlannerActivityApi;
}) {
  const { app, el, ctx, periodicNotes, plannerData, activityApi } = props;

  el.empty();
  el.addClass("day-planner-activity-goals-code-block");

  const component = mount(ActivityGoals as never, {
    target: el,
    props: {
      app,
      periodicNotes,
      plannerData,
      activityApi,
    },
  });

  ctx.addChild(
    new ActivityGoalsChild(el, component as unknown as SvelteComponent),
  );
}
