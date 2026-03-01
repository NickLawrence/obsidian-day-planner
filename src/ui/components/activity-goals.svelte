<script lang="ts">
  import type { App, TFile } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import type { PeriodicNotes } from "../../service/periodic-notes";
  import {
    getActivityDefinition,
    normalizeActivityName,
  } from "../../util/activity-definitions";
  import {
    calculateWeeklyActivityDurations,
    formatDuration,
    getWeekRangeFor,
    type ActivityDuration,
  } from "../../util/activity-log-summary";
  import type { DayPlannerActivityApi } from "../../util/activity-totals";
  import type { Activity } from "../../util/props";
  import {
    extractActivityGoals,
    mergeActivityDurationsWithGoals,
  } from "../../util/weekly-activity-goals";

  type GoalProgressRow = ActivityDuration & {
    goal: import("moment").Duration;
    dailyDurationsMs: number[];
  };

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
    periodicNotes,
    activityApi,
  }: {
    app: App;
    periodicNotes: PeriodicNotes;
    activityApi: DayPlannerActivityApi;
  } = $props();

  let rows = $state<GoalProgressRow[]>([]);
  let weekLabel = $state("");
  let isWeeklyNotesEnabled = $state(true);
  let dayColors = $state<DayColorInfo[]>([]);

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let offIndexReady: unknown;
  let offMetadataChange: unknown;

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

  function getDayColors(weekStart: import("moment").Moment): DayColorInfo[] {
    const dailyAccentPlugin = app.plugins?.getPlugin?.(
      "obsidian-daily-accent",
    ) as { api?: DailyAccentApi } | undefined;
    const accentApi = dailyAccentPlugin?.api;

    return Array.from({ length: 7 }, (_, dayIndex) => {
      const day = weekStart.clone().add(dayIndex, "day");
      const dayKey = day.format("YYYY-MM-DD");
      const accentInfo = accentApi?.getAccentForDayKey?.(dayKey);

      return {
        dayKey,
        shortLabel: day.format("ddd"),
        color: accentInfo?.css ?? getFallbackDayColor(dayIndex),
      };
    });
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
    isWeeklyNotesEnabled = periodicNotes.hasWeeklyNotesSupport();
    void refresh();

    offIndexReady = app.metadataCache?.on("dataview:index-ready", () => {
      void refresh();
    });

    offMetadataChange = app.metadataCache?.on(
      "dataview:metadata-change",
      () => {
        void refresh();
      },
    );

    refreshTimer = setInterval(() => {
      void refresh();
    }, 60_000);
  });

  onDestroy(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    if (offIndexReady) {
      app.metadataCache?.offref(offIndexReady);
    }

    if (offMetadataChange) {
      app.metadataCache?.offref(offMetadataChange);
    }
  });

  async function refresh() {
    const now = window.moment();
    const { start: weekStart, end: weekEnd } = getWeekRangeFor(now);
    weekLabel = `${weekStart.format("MMM D")} – ${weekEnd
      .clone()
      .subtract(1, "day")
      .format("MMM D")}`;

    if (!isWeeklyNotesEnabled) {
      rows = [];
      return;
    }

    const weekNote = periodicNotes.getWeeklyNote(weekStart);
    const goals = await getGoalsForWeek(weekNote);
    dayColors = getDayColors(weekStart);

    const allActivities = activityApi.getAllActivities();
    const dailyDurationsByActivity = getDailyDurationsForWeek(
      allActivities,
      weekStart,
      weekEnd,
    );

    const totals = calculateWeeklyActivityDurations(allActivities, now);
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
  }

  async function getGoalsForWeek(weekNote: TFile | null) {
    if (!weekNote) {
      return [];
    }

    return extractActivityGoals(app, weekNote);
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

  {#if !isWeeklyNotesEnabled}
    <div class="empty-state">
      Weekly notes support is required to show activity goals.
    </div>
  {:else if rows.length === 0}
    <div class="empty-state">
      No goals found for this week under the “Activity goals” heading.
    </div>
  {:else}
    <div class="goal-list">
      {#each rows as row (row.activityKey)}
        {@const definition = getActivityDefinition(row.activityKey)}
        {@const emoji = definition?.emoji ?? "🏁"}
        {@const label = definition?.label ?? sanitizeLabel(row.activity)}
        <div
          style={`--progress:${progressPercent(row.duration, row.goal)}%;--half-hour-step:${tickStepPercent(row.goal, 30)};--hour-step:${tickStepPercent(row.goal, 60)};`}
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
            </div>
          </div>
        </div>
      {/each}
    </div>

    <div class="legend" aria-label="Weekly day color legend">
      {#each dayColors as day}
        <div class="legend-item">
          <span style={`--legend-color:${day.color};`} class="legend-swatch"
          ></span>
          <span>{day.shortLabel}</span>
        </div>
      {/each}
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
      var(--background-primary) 88%,
      var(--interactive-accent) 12%
    );
    border: 1px solid var(--background-modifier-border);
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
      var(--background-secondary) 92%,
      var(--interactive-accent) 8%
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
    border-radius: var(--radius-m);
    background: color-mix(
      in srgb,
      var(--background-modifier-border) 78%,
      white
    );
    opacity: 0.86;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, white 36%, transparent);
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
    font-weight: 650;
    min-width: 0;
    overflow: hidden;
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
    border-radius: 999px;
    background: color-mix(
      in srgb,
      black 12%,
      var(--background-modifier-border)
    );
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

  .goal-ticks {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    pointer-events: none;
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
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-2) var(--size-4-2);
    padding-top: var(--size-2-1);
    border-top: 1px solid var(--background-modifier-border);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: var(--size-2-1);
  }

  .legend-swatch {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--legend-color, var(--interactive-accent));
    border: 1px solid color-mix(in srgb, black 30%, transparent);
  }

  .empty-state {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }
</style>
