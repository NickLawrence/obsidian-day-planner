import {
  MarkdownRenderChild,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { mount, type SvelteComponent, unmount } from "svelte";

import ActivityPlan from "./components/activity-plan.svelte";

class ActivityPlanChild extends MarkdownRenderChild {
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

export function renderActivityPlanCodeBlock(props: {
  app: import("obsidian").App;
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
  periodicNotes: import("../service/periodic-notes").PeriodicNotes;
}) {
  const { app, el, ctx, periodicNotes } = props;

  el.empty();
  el.addClass("day-planner-activity-plan-code-block");

  const component = mount(ActivityPlan as never, {
    target: el,
    props: {
      app,
      periodicNotes,
    },
  });

  ctx.addChild(
    new ActivityPlanChild(el, component as unknown as SvelteComponent),
  );
}
