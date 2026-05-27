<script lang="ts">
  import type { Readable } from "svelte/store";

  import { currentTimeSignal } from "../../global-store/current-time";
  import { addHorizontalPlacing } from "../../overlap/overlap";
  import { isRemote, type Task, type WithTime } from "../../task-types";
  import { getActivityGroup } from "../../util/activity-definitions";
  import { doesOverlapWithRange } from "../../util/moment";
  import * as t from "../../util/task-utils";

  const {
    blocks,
  }: {
    blocks: Readable<Array<WithTime<Task>>>;
  } = $props();

  type ActivityBlockTask = Task & {
    clockActivity?: {
      activity: string;
    };
  };

  const hours = 24;
  const timelineWidthPx = 360;
  const hourSegmentWidthPx = timelineWidthPx / hours;
  const majorHourStep = 6;
  const minuteWidthPx = timelineWidthPx / (hours * 60);

  const timeMarkerWidthPx = 8;
  const timeMarkerHalfWidthPx = timeMarkerWidthPx / 2;
  const timeMarkerOffsetPx = $derived(timelineWidthPx - timeMarkerHalfWidthPx);

  const rangeStart = $derived(
    currentTimeSignal.current.clone().subtract(hours, "hours"),
  );
  const rangeEnd = $derived(currentTimeSignal.current.clone());

  function getBlockColor(block: WithTime<Task>) {
    if (isRemote(block)) {
      return block.calendar.color;
    }

    const activityName = (block as ActivityBlockTask).clockActivity?.activity;
    const activityGroup = activityName
      ? getActivityGroup(activityName)
      : undefined;

    return activityGroup?.color ?? "var(--color-base-50)";
  }

  const displayedBlocks = $derived.by(() => {
    const clampedTasksForRange = $blocks
      .filter((it) =>
        doesOverlapWithRange(
          { start: it.startTime, end: t.getEndTime(it) },
          {
            start: rangeStart,
            end: rangeEnd,
          },
        ),
      )
      .map((it) => t.clamp(it, rangeStart, rangeEnd));

    return addHorizontalPlacing(clampedTasksForRange);
  });
</script>

<div
  style:--time-marker-half-width-px="{timeMarkerHalfWidthPx}px"
  style:--time-marker-offset-y-px="-3px"
  class="status-bar-item-segment mini-timeline"
  style:width="{timelineWidthPx}px"
>
  <div style:left="{timeMarkerOffsetPx}px" class="time-marker top"></div>
  <div style:left="{timeMarkerOffsetPx}px" class="time-marker bottom"></div>

  <div class="mini-time-block-wrapper">
    {#each displayedBlocks as block}
      <div
        style:width="{block.durationMinutes * minuteWidthPx}px"
        style:left="{block.startTime.clone().diff(rangeStart, `minutes`) * minuteWidthPx}px"
        style:height="{block.placing.spanPercent}%"
        style:bottom="{block.placing.offsetPercent}%"
        style:background-color={getBlockColor(block)}
        class="mini-time-block"
        aria-label={t.getOneLineSummary(block)}
      ></div>
    {/each}
  </div>

  {#each Array.from({ length: hours }) as _, index}
    <div
      class={[
        "hour-segment",
        (index + 1) % majorHourStep === 0 && "hour-end-segment",
      ]}
      style:width="{hourSegmentWidthPx}px"
    ></div>
  {/each}
</div>

<style>
  .mini-timeline {
    position: relative;

    display: flex;
    gap: 0;
    align-items: stretch;

    height: 100%;

    background-color: transparent;
  }

  .time-marker {
    position: absolute;
    z-index: 2;

    width: 0;
    height: 0;

    border-right: var(--time-marker-half-width-px) solid transparent;
    border-left: var(--time-marker-half-width-px) solid transparent;
  }

  .time-marker.top {
    top: var(--time-marker-offset-y-px);
    border-top: var(--time-marker-half-width-px) solid var(--color-accent);
    border-top-left-radius: 2px;
    border-top-right-radius: 2px;
  }

  .time-marker.bottom {
    bottom: var(--time-marker-offset-y-px);
    border-bottom: var(--time-marker-half-width-px) solid var(--color-accent);
    border-bottom-right-radius: 2px;
    border-bottom-left-radius: 2px;
  }

  .hour-segment {
    position: relative;
    top: -15%;

    flex: 0 0 auto;
    height: 130%;

    background-color: transparent;
  }

  .hour-segment:not(:last-child) {
    border-right: 1px solid var(--text-faint);
  }

  .hour-end-segment:not(:last-child) {
    top: -20%;
    left: 1px;
    height: 140%;
    border-right: 2px solid var(--text-faint);
  }

  .mini-time-block-wrapper {
    position: absolute;
    z-index: 1;
    inset: 0;
    overflow: hidden;
  }

  .mini-time-block {
    position: absolute;

    display: flex;
    align-items: center;

    border: 1px solid color-mix(in srgb, white 20%, transparent);
  }
</style>
