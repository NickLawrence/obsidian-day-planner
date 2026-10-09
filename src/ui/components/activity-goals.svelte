<script lang="ts">
  import type { App } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import type { PlannerData } from "../../service/planner-data";
  import {
    getActivityDefinition,
    normalizeActivityName,
  } from "../../util/activity-definitions";
  import {
    calculateWeeklyActivityDurations,
    calculateWeeklyUnrecordedActivityDuration,
    getWeekRangeFor,
    type ActivityDuration,
  } from "../../util/activity-log-summary";
  import type { DayPlannerActivityApi } from "../../util/activity-totals";
  import { formatDuration } from "../../util/duration";
  import type { Activity } from "../../util/props";
  import { mergeActivityDurationsWithGoals } from "../../util/weekly-activity-goals";

  type GoalProgressRow = ActivityDuration & {
    goal: import("moment").Duration;
    dailyDurationsMs: number[];
  };

  type OtherActivityRow = ActivityDuration;

  type DayColorInfo = {
    dayKey: string;
    shortLabel: string;
    color: string;
  };

  type DailyAccentApi = {
    getAccentForDayKey?: (dayKey: string) => {
      css?: string;
    };
  };

  let {
    app,
    plannerData,
    activityApi,
  }: {
    app: App;
    plannerData: PlannerData;
    activityApi: DayPlannerActivityApi;
  } = $props();

  let rows = $state<GoalProgressRow[]>([]);
  let totalRow = $state<GoalProgressRow | null>(null);
  let otherActivityRows = $state<OtherActivityRow[]>([]);
  let unrecordedTime = $state(window.moment.duration(0));
  let weekLabel = $state("");
  let weekProgressPercent = $state(0);
  let dayColors = $state<DayColorInfo[]>([]);
  let legendDays = $state<DayColorInfo[]>([]);

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let stopPlannerListener: (() => void) | undefined;

  function sanitizeLabel(label: string) {
    return (
      label
        .replace(
          /^[\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}\s]+/u,
          "",
        )
        .trim() || label
    );
  }

  function getFallbackDayColor(dayIndex: number) {
    return `hsl(${Math.round((dayIndex * 360) / 7)} 72% 62%)`;
  }

  function getDayColors(weekStart: import("moment").Moment) {
    const dailyAccentPlugin = (
      app as App & { plugins?: { getPlugin?: (id: string) => unknown } }
    ).plugins?.getPlugin?.("obsidian-daily-accent") as
      | { api?: DailyAccentApi }
      | undefined;
    const accentApi = dailyAccentPlugin?.api;
    const isDailyAccentPluginActive = Boolean(dailyAccentPlugin);

    const colors = Array.from({ length: 7 }, (_, dayIndex) => {
      const day = weekStart.clone().add(dayIndex, "day");
      const dayKey = day.format("YYYY-MM-DD");
      const accentInfo = accentApi?.getAccentForDayKey?.(dayKey);

      return {
        dayKey,
        shortLabel: day.format("ddd"),
        color: accentInfo?.css ?? getFallbackDayColor(dayIndex),
      };
    });

    return {
      colors,
      isDailyAccentPluginActive,
    };
  }

  function getLegendDays(
    colors: DayColorInfo[],
    isDailyAccentPluginActive: boolean,
    weekStart: import("moment").Moment,
    now: import("moment").Moment,
  ) {
    if (!isDailyAccentPluginActive) {
      return colors;
    }

    const todayIndex = now.clone().startOf("day").diff(weekStart, "days");
    return colors.filter((_, dayIndex) => dayIndex <= todayIndex);
  }

  function getDailyDurationsForWeek(
    activities: Activity[],
    weekStart: import("moment").Moment,
    weekEnd: import("moment").Moment,
  ) {
    const durationsByActivity = new Map<string, number[]>();

    activities.forEach(({ activity, log }) => {
      const activityKey = normalizeActivityName(activity);
      const durations =
        durationsByActivity.get(activityKey) ?? Array(7).fill(0);

      log?.forEach(({ start, end }) => {
        const startMoment = window.moment(start, window.moment.ISO_8601, true);
        const endMoment = end
          ? window.moment(end, window.moment.ISO_8601, true)
          : window.moment();

        if (!startMoment.isValid() || !endMoment.isValid()) {
          return;
        }

        const clampedStart = window.moment.max(startMoment, weekStart);
        const clampedEnd = window.moment.min(endMoment, weekEnd);

        if (!clampedEnd.isAfter(clampedStart)) {
          return;
        }

        let segmentStart = clampedStart.clone();
        while (segmentStart.isBefore(clampedEnd)) {
          const currentDayStart = segmentStart.clone().startOf("day");
          const nextDayStart = currentDayStart.clone().add(1, "day");
          const segmentEnd = window.moment.min(clampedEnd, nextDayStart);
          const dayIndex = currentDayStart.diff(weekStart, "days");

          if (dayIndex >= 0 && dayIndex < 7) {
            durations[dayIndex] += segmentEnd.diff(
              segmentStart,
              "milliseconds",
            );
          }

          segmentStart = segmentEnd;
        }
      });

      durationsByActivity.set(activityKey, durations);
    });

    return durationsByActivity;
  }

  function getWeekProgressPercent(
    weekStart: import("moment").Moment,
    weekEnd: import("moment").Moment,
    now: import("moment").Moment,
  ) {
    const weekDurationMs = Math.max(1, weekEnd.diff(weekStart));
    const elapsedMs = now.diff(weekStart);

    return Math.max(0, Math.min(100, (elapsedMs / weekDurationMs) * 100));
  }

  function getProgressSegments(row: GoalProgressRow) {
    const goalMs = Math.max(1, row.goal.asMilliseconds());
    let left = 0;

    return row.dailyDurationsMs
      .map((durationMs, dayIndex) => {
        const width = Math.max(0, (durationMs / goalMs) * 100);
        const clampedLeft = Math.min(100, left);
        const remaining = Math.max(0, 100 - clampedLeft);
        const clampedWidth = Math.min(remaining, width);
        left += width;

        return {
          color: dayColors[dayIndex]?.color ?? getFallbackDayColor(dayIndex),
          left: clampedLeft,
          width: clampedWidth,
        };
      })
      .filter((segment) => segment.width > 0);
  }

  onMount(() => {
    void refresh();
    stopPlannerListener = plannerData.onChange(() => void refresh());

    refreshTimer = setInterval(() => {
      void refresh();
    }, 60_000);
  });

  onDestroy(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    stopPlannerListener?.();
  });

  async function refresh() {
    const now = window.moment();
    const { start: weekStart, end: weekEnd } = getWeekRangeFor(now);
    weekLabel = `${weekStart.format("MMM D")} – ${weekEnd
      .clone()
      .subtract(1, "day")
      .format("MMM D")}`;
    weekProgressPercent = getWeekProgressPercent(weekStart, weekEnd, now);

    const planEntries = (await plannerData.readPlanEntries(weekStart)).map(
      (entry) => ({
        ...entry,
        duration: window.moment.duration(entry.duration, "minutes"),
      }),
    );
    const goals = planEntries
      .filter((entry) => entry.kind === "goal")
      .map((entry) => ({ activity: entry.activity, goal: entry.duration }));
    const { colors, isDailyAccentPluginActive } = getDayColors(weekStart);
    dayColors = colors;
    legendDays = getLegendDays(
      colors,
      isDailyAccentPluginActive,
      weekStart,
      now,
    );

    const allActivities = activityApi.getAllActivities();
    const dailyDurationsByActivity = getDailyDurationsForWeek(
      allActivities,
      weekStart,
      weekEnd,
    );

    const totals = calculateWeeklyActivityDurations(allActivities, now);
    unrecordedTime = calculateWeeklyUnrecordedActivityDuration(
      allActivities,
      now,
    );
    const withGoals = mergeActivityDurationsWithGoals(totals, goals);

    rows = withGoals
      .filter((entry): entry is GoalProgressRow => Boolean(entry.goal))
      .map((entry) => ({
        ...entry,
        dailyDurationsMs:
          dailyDurationsByActivity.get(entry.activityKey) ?? Array(7).fill(0),
      }))
      .sort((a, b) => {
        const aGoalMs = Math.max(1, a.goal.asMilliseconds());
        const bGoalMs = Math.max(1, b.goal.asMilliseconds());

        const aRatio = a.duration.asMilliseconds() / aGoalMs;
        const bRatio = b.duration.asMilliseconds() / bGoalMs;

        if (Math.abs(aRatio - bRatio) > 1e-9) {
          return bRatio - aRatio;
        }

        return a.activity.localeCompare(b.activity, undefined, {
          sensitivity: "base",
        });
      });

    totalRow =
      rows.length > 0
        ? {
            activity: "Total",
            activityKey: "total",
            duration: window.moment.duration(
              rows.reduce(
                (total, row) => total + row.duration.asMilliseconds(),
                0,
              ),
            ),
            goal: window.moment.duration(
              rows.reduce((total, row) => total + row.goal.asMilliseconds(), 0),
            ),
            dailyDurationsMs: rows.reduce(
              (totalsByDay, row) =>
                totalsByDay.map(
                  (total, dayIndex) =>
                    total + (row.dailyDurationsMs[dayIndex] ?? 0),
                ),
              Array(7).fill(0) as number[],
            ),
          }
        : null;

    otherActivityRows = withGoals
      .filter((entry) => !entry.goal && entry.duration.asMilliseconds() > 0)
      .map(({ activity, activityKey, duration }) => ({
        activity,
        activityKey,
        duration,
      }))
      .sort((a, b) => {
        const durationDiff =
          b.duration.asMilliseconds() - a.duration.asMilliseconds();

        if (durationDiff !== 0) {
          return durationDiff;
        }

        return a.activity.localeCompare(b.activity, undefined, {
          sensitivity: "base",
        });
      });
  }

  function progressPercent(
    duration: import("moment").Duration,
    goal: import("moment").Duration,
  ) {
    const spent = Math.max(0, duration.asMilliseconds());
    const target = Math.max(1, goal.asMilliseconds());

    return Math.min(100, (spent / target) * 100);
  }

  function isComplete(
    duration: import("moment").Duration,
    goal: import("moment").Duration,
  ) {
    return duration.asMilliseconds() >= goal.asMilliseconds();
  }

  const msPerMin = 60_000;

  function tickStepPercent(goal: import("moment").Duration, minutes: number) {
    const goalMs = Math.max(1, goal.asMilliseconds());
    const pct = (minutes * msPerMin * 100) / goalMs;

    return `${Math.max(0.5, Math.min(1000, pct))}%`;
  }
</script>

<div class="activity-goals">
  <div class="header">
    <h3>Weekly Goals</h3>
    <div class="subtitle">{weekLabel}</div>
  </div>

  {#if rows.length === 0 && otherActivityRows.length === 0 && unrecordedTime.asMilliseconds() === 0}
    <div class="empty-state">
      No goals found for this week under the “Activity goals” heading.
    </div>
  {:else}
    <div class="legend" aria-label="Weekly day color legend">
      {#each legendDays as day}
        <div class="legend-item">
          <span style={`--legend-color:${day.color};`} class="legend-swatch"
          ></span>
          <span>{day.shortLabel}</span>
        </div>
      {/each}
    </div>
    <div class="goal-list">
      {#each rows as row (row.activityKey)}
        {@const definition = getActivityDefinition(row.activityKey)}
        {@const emoji = definition?.emoji ?? "🏁"}
        {@const label = definition?.label ?? sanitizeLabel(row.activity)}
        <div
          style={`--progress:${progressPercent(row.duration, row.goal)}%;--week-progress:${weekProgressPercent}%;--half-hour-step:${tickStepPercent(row.goal, 30)};--hour-step:${tickStepPercent(row.goal, 60)};`}
          class="goal-card"
        >
          <div class="emoji-box" aria-hidden="true">
            <div class="emoji">{emoji}</div>
          </div>

          <div class="goal-body">
            <div class="goal-top-row">
              <div class="name">{label}</div>
              <div
                class="value"
                class:complete={isComplete(row.duration, row.goal)}
              >
                {formatDuration(row.duration)} / {formatDuration(row.goal)}
              </div>
            </div>

            <div class="goal-track" aria-hidden="true">
              <div class="goal-fill-bg"></div>
              <div class="goal-ticks"></div>
              {#each getProgressSegments(row) as segment, index (`${row.activityKey}-${index}`)}
                <div
                  style={`--segment-left:${segment.left}%;--segment-width:${segment.width}%;--segment-color:${segment.color};`}
                  class="goal-day-segment"
                ></div>
              {/each}
              <div class="week-progress-marker" title="Week progress"></div>
            </div>
          </div>
        </div>
      {/each}

      {#if totalRow}
        <div
          style={`--progress:${progressPercent(totalRow.duration, totalRow.goal)}%;--week-progress:${weekProgressPercent}%;--half-hour-step:${tickStepPercent(totalRow.goal, 30)};--hour-step:${tickStepPercent(totalRow.goal, 60)};`}
          class="goal-card total-card"
        >
          <div class="emoji-box total-emoji-box" aria-hidden="true">
            <div class="emoji">∑</div>
          </div>

          <div class="goal-body">
            <div class="goal-top-row">
              <div class="name">Total</div>
              <div
                class="value"
                class:complete={isComplete(totalRow.duration, totalRow.goal)}
              >
                {formatDuration(totalRow.duration)} / {formatDuration(
                  totalRow.goal,
                )}
              </div>
            </div>

            <div class="goal-track" aria-hidden="true">
              <div class="goal-fill-bg"></div>
              <div class="goal-ticks"></div>
              {#each getProgressSegments(totalRow) as segment, index (`total-${index}`)}
                <div
                  style={`--segment-left:${segment.left}%;--segment-width:${segment.width}%;--segment-color:${segment.color};`}
                  class="goal-day-segment"
                ></div>
              {/each}
              <div class="week-progress-marker" title="Week progress"></div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="other-activities" aria-label="Other weekly activities">
      {#each otherActivityRows as activity (activity.activityKey)}
        {@const definition = getActivityDefinition(activity.activityKey)}
        {@const emoji = definition?.emoji ?? "•"}
        {@const label = definition?.label ?? sanitizeLabel(activity.activity)}
        <div class="other-activity-card" title={label}>
          <span class="other-activity-emoji" aria-hidden="true">{emoji}</span>
          <span class="other-activity-label">{label}</span>
          <span class="other-activity-duration"
            >{formatDuration(activity.duration)}</span
          >
        </div>
      {/each}
      <div
        class="other-activity-card"
        title="Time in the week not covered by any activity log"
      >
        <span class="other-activity-emoji" aria-hidden="true">◷</span>
        <span class="other-activity-label">Unrecorded time</span>
        <span class="other-activity-duration"
          >{formatDuration(unrecordedTime)}</span
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .activity-goals {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);

    padding: var(--size-4-3);

    background: color-mix(
      in srgb,
      var(--background-primary) 98%,
      var(--interactive-accent) 2%
    );
    border: 1px solid var(--background-modifier);
    border-radius: var(--radius-m);
  }

  .header h3 {
    margin: 0;
    font-size: var(--font-ui-large);
    font-weight: 750;
  }

  .subtitle {
    margin-top: 2px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .goal-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  /* --- Layout: emoji on the left of both label + bar --- */
  .goal-card {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--size-4-3);
    align-items: center;

    padding: var(--size-4-2) var(--size-4-3);

    background: color-mix(
      in srgb,
      var(--background-secondary) 95%,
      var(--interactive-accent) 5%
    );
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }

  .emoji-box {
    display: flex;
    align-items: center;
    justify-content: center;

    width: 2.8em;
    height: 2.8em;
    padding: 0.2em;

    opacity: 0.86;
    background: color-mix(
      in srgb,
      var(--background-modifier-border) 60%,
      black
    );
    border-radius: var(--radius-m);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, black 36%, transparent);
  }

  .total-card {
    margin-top: var(--size-2-2);
    border-color: color-mix(
      in srgb,
      var(--interactive-accent) 35%,
      var(--background-modifier-border)
    );
  }

  .total-emoji-box {
    color: var(--text-normal);
    background: color-mix(
      in srgb,
      var(--interactive-accent) 20%,
      var(--background-modifier-border)
    );
  }

  .emoji {
    font-size: 1.75em;
    line-height: 1;
    text-align: center;
    opacity: 0.95;
  }

  .goal-body {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
    min-width: 0;
  }

  .goal-top-row {
    display: flex;
    gap: var(--size-4-2);
    align-items: baseline;
    justify-content: space-between;
  }

  .name {
    overflow: hidden;

    min-width: 0;

    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .value.complete {
    color: var(--text-normal);
  }

  /* --- Progress bar with time ticks --- */
  .goal-track {
    position: relative;

    overflow: hidden;

    height: 12px;

    background: color-mix(
      in srgb,
      var(--background-modifier-border) 65%,
      black
    );
    border-radius: 999px;
  }

  .goal-fill-bg {
    position: absolute;
    inset: 0;
    background: color-mix(
      in srgb,
      black 12%,
      var(--background-modifier-border)
    );
    border-radius: 999px;
  }

  .goal-day-segment {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--segment-left, 0%);

    width: var(--segment-width, 0%);

    background: var(--segment-color, var(--interactive-accent));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, white 35%, transparent);
  }

  .week-progress-marker {
    pointer-events: none;

    position: absolute;
    z-index: 2;
    top: -2px;
    bottom: -2px;
    left: var(--week-progress, 0%);
    transform: translateX(-1px);

    width: 2px;

    background: color-mix(in srgb, var(--text-normal) 78%, white);
    border-radius: 999px;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--background-primary) 72%, transparent),
      0 0 6px color-mix(in srgb, black 35%, transparent);
  }

  .goal-ticks {
    pointer-events: none;

    position: absolute;
    inset: 0;

    background-image: repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--half-hour-step, 100%) - 1px),
        color-mix(in srgb, white 26%, transparent)
          calc(var(--half-hour-step, 100%) - 1px),
        color-mix(in srgb, white 26%, transparent) var(--half-hour-step, 100%)
      ),
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--hour-step, 100%) - 2px),
        color-mix(in srgb, white 52%, transparent)
          calc(var(--hour-step, 100%) - 2px),
        color-mix(in srgb, white 52%, transparent) var(--hour-step, 100%)
      );
    border-radius: 999px;
  }

  .other-activities {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-2);
  }

  .other-activity-card {
    display: inline-flex;
    gap: var(--size-2-1);
    align-items: center;

    min-width: 0;
    max-width: 22em;
    min-height: 2.75em;
    padding: var(--size-4-1) var(--size-4-3);

    font-size: var(--font-ui-large);
    color: var(--text-muted);

    background: color-mix(
      in srgb,
      var(--background-secondary) 92%,
      var(--background-modifier-border) 8%
    );
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .other-activity-emoji {
    flex: 0 0 auto;
    font-size: --font-ui-large;
  }

  .other-activity-label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .other-activity-duration {
    flex: 0 0 auto;
    margin-left: var(--size-4-1);
    font-variant-numeric: tabular-nums;
    color: var(--text-normal);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-2) var(--size-4-2);

    padding-top: var(--size-2-1);

    font-size: var(--font-ui-smaller);
    color: var(--text-muted);

    border-top: 1px solid var(--background-modifier-border);
  }

  .legend-item {
    display: inline-flex;
    gap: var(--size-2-1);
    align-items: center;
  }

  .legend-swatch {
    width: 10px;
    height: 10px;

    background: var(--legend-color, var(--interactive-accent));
    border: 1px solid color-mix(in srgb, black 30%, transparent);
    border-radius: 999px;
  }

  .empty-state {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }
</style>
