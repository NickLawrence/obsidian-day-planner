<script lang="ts">
  import type { Moment } from "moment";

  import { get } from "svelte/store";
  import { isNotVoid } from "typed-assert";

  import { getObsidianContext } from "../../context/obsidian-context";
  import { currentTime, isToday } from "../../global-store/current-time";
  import { getVisibleHours, snap } from "../../global-store/derived-settings";
  import {
    isRemote,
    type LocalTask,
    type Task,
    type WithPlacing,
    type WithTime,
  } from "../../task-types";
  import {
    getIsomorphicClientY,
    isTouchEvent,
    offsetYToMinutes,
  } from "../../util/dom";
  import { minutesToMomentOfDay } from "../../util/moment";
  import { getRenderKey } from "../../util/task-utils";
  import { createGestures } from "../actions/gestures";

  import Column from "./column.svelte";
  import ActivityTimeBlock from "./activity-time-block.svelte";
  import LocalTimeBlock from "./local-time-block.svelte";
  import Needle from "./needle.svelte";
  import PositionedTimeBlock from "./positioned-time-block.svelte";
  import RemoteTimeBlockContent from "./remote-time-block-content.svelte";
  import TimeBlockBase from "./time-block-base.svelte";
  import UnscheduledTimeBlock from "./unscheduled-time-block.svelte";

  const {
    day,
    isUnderCursor = false,
  }: { day: Moment; isUnderCursor?: boolean } = $props();

  const {
    settings,
    editContext: {
      confirmEdit,
      handlers: { handleContainerMouseDown },
      getDisplayedTasksForTimeline,
      editOperation,
    },
    pointerDateTime,
    getDisplayedTasksWithClocksForTimeline,
    settingsSignal,
  } = getObsidianContext();

  const displayedTasksForTimeline = $derived(getDisplayedTasksForTimeline(day));
  const displayedTasksWithClocksForTimeline = $derived(
    getDisplayedTasksWithClocksForTimeline(day),
  );

  const displayedUpcomingPlannerTasksForTracker = $derived.by(() => {
    if (day.isBefore($currentTime, "day")) {
      return [];
    }

    return $displayedTasksForTimeline.withTime
      .filter((task): task is WithPlacing<WithTime<Task>> => {
        if (task.isAllDayEvent) {
          return false;
        }

        const taskEnd = task.startTime
          .clone()
          .add(task.durationMinutes, "minutes");

        if (day.isSame($currentTime, "day")) {
          return taskEnd.isAfter($currentTime);
        }

        return true;
      })
      .map((task) => {
        if (
          !day.isSame($currentTime, "day") ||
          task.startTime.isSameOrAfter($currentTime)
        ) {
          return task;
        }

        const taskEnd = task.startTime
          .clone()
          .add(task.durationMinutes, "minutes");

        return {
          ...task,
          startTime: $currentTime.clone(),
          durationMinutes: taskEnd.diff($currentTime, "minutes"),
          truncated: [...(task.truncated ?? []), "top" as const],
        };
      });
  });

  const displayedPlannerTasksForCombined = $derived.by(() =>
    $displayedTasksForTimeline.withTime.filter((task) => {
      if (day.isBefore($currentTime, "day")) {
        return true;
      }

      const taskEnd = task.startTime.clone().add(task.durationMinutes, "minutes");

      if (day.isSame($currentTime, "day")) {
        return !taskEnd.isAfter($currentTime);
      }

      return false;
    }),
  );

  const displayedUpcomingPlannerTasksOnlyForTracker = $derived.by(() => {
    const displayedClockTaskKeys = new Set(
      $displayedTasksWithClocksForTimeline.map(getRenderKey),
    );

    return displayedUpcomingPlannerTasksForTracker.filter(
      (task) => !displayedClockTaskKeys.has(getRenderKey(task)),
    );
  });

  let el: HTMLElement | undefined = $state();

  function updatePointerDateTime(event: MouseEvent | TouchEvent) {
    isNotVoid(el);

    const viewportToElOffsetY = el.getBoundingClientRect().top;
    const borderTopToPointerOffsetY =
      getIsomorphicClientY(event) - viewportToElOffsetY;
    const newOffsetY = snap(borderTopToPointerOffsetY, $settings);

    const minutesSinceMidnight = offsetYToMinutes(
      newOffsetY,
      settingsSignal.current.zoomLevel,
      settingsSignal.current.startHour,
    );
    const dateTime = minutesToMomentOfDay(
      minutesSinceMidnight,
      window.moment(day),
    );
    // todo: might hurt perf. Need to check for identity of time not to run on every change of coords
    pointerDateTime.set({ dateTime, type: "dateTime" });
  }

  function handleContainerPointerDown(event: MouseEvent | TouchEvent) {
    updatePointerDateTime(event);
    handleContainerMouseDown();
  }

  const timelineGestures = createGestures({
    onlongpress: (event) => {
      if (event.target !== el) {
        return;
      }

      handleContainerPointerDown(event);
    },
    onpanmove: (event) => {
      if (get(editOperation)) {
        updatePointerDateTime(event);
      }
    },
    onpanend: confirmEdit,
    options: { mouseSupport: false },
  });
</script>

{#if $settings.timelineColumns.planner && !$settings.timelineColumns.combined}
  <Column visibleHours={getVisibleHours($settings)}>
    {#if $isToday(day)}
      <Needle autoScrollBlocked={isUnderCursor} />
    {/if}

    <div
      bind:this={el}
      class="tasks absolute-stretch-x"
      onpointerdown={(event) => {
        if (isTouchEvent(event) || event.target !== el) {
          return;
        }

        handleContainerPointerDown(event);
      }}
      onpointermove={updatePointerDateTime}
      onpointerup={confirmEdit}
      use:timelineGestures
    >
      {#each $displayedTasksForTimeline.withTime as task (getRenderKey(task))}
        <PositionedTimeBlock {task}>
          <UnscheduledTimeBlock {task} />
        </PositionedTimeBlock>
      {/each}
    </div>
  </Column>
{/if}

{#if $settings.timelineColumns.combined}
  <Column
    --column-background-color="hsl(var(--color-accent-hsl), 0.03)"
    visibleHours={getVisibleHours($settings)}
  >
    {#if $isToday(day)}
      <Needle autoScrollBlocked={isUnderCursor} />
    {/if}

    <div class="tasks absolute-stretch-x">
      {#each displayedPlannerTasksForCombined as task (getRenderKey(task))}
        <PositionedTimeBlock {task}>
          <UnscheduledTimeBlock {task} />
        </PositionedTimeBlock>
      {/each}
    </div>

    <div class="tasks activity-tasks absolute-stretch-x">
      {#each $displayedTasksWithClocksForTimeline as task (`clock:${getRenderKey(task)}`)}
        <PositionedTimeBlock {task}>
          <ActivityTimeBlock {task} />
        </PositionedTimeBlock>
      {/each}
    </div>

    <div class="tasks tracker-tasks absolute-stretch-x">
      {#each displayedUpcomingPlannerTasksOnlyForTracker as task (`tracker:${getRenderKey(task)}`)}
        <PositionedTimeBlock {task}>
          {#if isRemote(task)}
            <TimeBlockBase {task}>
              <RemoteTimeBlockContent {task} />
            </TimeBlockBase>
          {:else}
            <LocalTimeBlock {task} />
          {/if}
        </PositionedTimeBlock>
      {/each}
    </div>
  </Column>
{/if}

{#if $settings.timelineColumns.timeTracker && !$settings.timelineColumns.combined}
  <Column
    --column-background-color="hsl(var(--color-accent-hsl), 0.03)"
    visibleHours={getVisibleHours($settings)}
  >
    {#if $isToday(day)}
      <Needle autoScrollBlocked={isUnderCursor} showBall={false} />
    {/if}

    <div class="tasks activity-tasks absolute-stretch-x">
      {#each $displayedTasksWithClocksForTimeline as task (getRenderKey(task))}
        <PositionedTimeBlock {task}>
          <ActivityTimeBlock {task} />
        </PositionedTimeBlock>
      {/each}
    </div>
  </Column>
{/if}

<style>
  .tasks {
    top: 0;
    bottom: 0;

    display: flex;
    flex-direction: column;

    margin-inline: var(--size-4-2);
  }

  .tracker-tasks {
    opacity: 0.78;
    margin-inline-start: calc(var(--size-4-2) + var(--size-4-8));
  }

  .activity-tasks {
    z-index: 1;
  }
</style>
