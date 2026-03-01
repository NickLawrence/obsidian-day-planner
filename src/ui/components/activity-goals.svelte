<script lang="ts">
  import type { App, TFile } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import type { PeriodicNotes } from "../../service/periodic-notes";
  import type { DayPlannerActivityApi } from "../../util/activity-totals";
  import {
    calculateWeeklyActivityDurations,
    formatDuration,
    getWeekRangeFor,
    type ActivityDuration,
  } from "../../util/activity-log-summary";
  import {
    extractActivityGoals,
    mergeActivityDurationsWithGoals,
  } from "../../util/weekly-activity-goals";

  type GoalProgressRow = ActivityDuration & {
    goal: import("moment").Duration;
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

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let offIndexReady: any;
  let offMetadataChange: any;

  // --- Emoji extraction (leading emoji token) ---
  const graphemeSegmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  function splitLeadingEmoji(activity: string) {
    const trimmed = activity.trimStart();

    if (!trimmed) return { emoji: "", label: activity };

    if (graphemeSegmenter) {
      const iter = graphemeSegmenter.segment(trimmed)[Symbol.iterator]();
      const first = iter.next().value?.segment as string | undefined;

      if (first && /\p{Extended_Pictographic}/u.test(first)) {
        const rest = trimmed.slice(first.length).trimStart();
        return { emoji: first, label: rest || trimmed };
      }
    }

    // Fallback: try a simple "first token emoji" regex
    const m = trimmed.match(
      /^\s*(\p{Extended_Pictographic}[\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}]*)\s*(.*)$/u,
    );
    if (m) {
      return { emoji: m[1] ?? "", label: (m[2] ?? "").trimStart() || trimmed };
    }

    return { emoji: "", label: activity };
  }

  // --- Tick sizing: thin every 30 min, thick every 60 min (as % of goal) ---
  const MS_PER_MIN = 60_000;

  function tickStepPercent(goal: import("moment").Duration, minutes: number) {
    const goalMs = Math.max(1, goal.asMilliseconds());
    const pct = (minutes * MS_PER_MIN * 100) / goalMs;

    // Prevent pathological values that make calc() go negative with px widths.
    const clamped = Math.max(0.5, Math.min(1000, pct));
    return `${clamped}%`;
  }

  onMount(() => {
    isWeeklyNotesEnabled = periodicNotes.hasWeeklyNotesSupport();
    void refresh();

    offIndexReady = app.metadataCache?.on("dataview:index-ready", () => {
      void refresh();
    });

    offMetadataChange = app.metadataCache?.on("dataview:metadata-change", () => {
      void refresh();
    });

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

    const totals = calculateWeeklyActivityDurations(
      activityApi.getAllActivities(),
      now,
    );
    const withGoals = mergeActivityDurationsWithGoals(totals, goals);

    rows = withGoals
      .filter((entry): entry is GoalProgressRow => Boolean(entry.goal))
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
        {@const parts = splitLeadingEmoji(row.activity)}
        <div
          class="goal-card"
          style={`--progress:${progressPercent(row.duration, row.goal)}%;
                  --half-hour-step:${tickStepPercent(row.goal, 30)};
                  --hour-step:${tickStepPercent(row.goal, 60)};`}
        >
          <div class="emoji" aria-hidden="true">{parts.emoji}</div>

          <div class="goal-body">
            <div class="goal-top-row">
              <div class="name">{parts.label}</div>
              <div class="value" class:complete={isComplete(row.duration, row.goal)}>
                {formatDuration(row.duration)} / {formatDuration(row.goal)}
              </div>
            </div>

            <div class="goal-track" aria-hidden="true">
              <div class="goal-fill" class:complete={isComplete(row.duration, row.goal)}></div>
            </div>
          </div>
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

  .emoji {
    font-size: 1.75em;
    line-height: 1;
    width: 1.8em;
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

  /* Full-width fill, clipped to progress so ticks stay aligned to the goal scale */
  .goal-fill {
    position: absolute;
    inset: 0;

    /* Clip the full-width fill down to the progress amount */
    clip-path: inset(0 calc(100% - var(--progress, 0%)) 0 0 round 999px);

    background-color: color-mix(in srgb, var(--interactive-accent) 86%, white);

    /* thin ticks every 30 min + thicker ticks every 60 min */
    background-image:
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--half-hour-step, 100%) - 1px),
        color-mix(in srgb, white 32%, transparent) calc(var(--half-hour-step, 100%) - 1px),
        color-mix(in srgb, white 32%, transparent) var(--half-hour-step, 100%)
      ),
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--hour-step, 100%) - 2px),
        color-mix(in srgb, white 55%, transparent) calc(var(--hour-step, 100%) - 2px),
        color-mix(in srgb, white 55%, transparent) var(--hour-step, 100%)
      );

    box-shadow: 0 0 8px
      color-mix(in srgb, var(--interactive-accent) 58%, transparent);
  }

  .goal-fill.complete {
    background-color: color-mix(in srgb, var(--color-green) 80%, white);
    background-image:
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--half-hour-step, 100%) - 1px),
        color-mix(in srgb, white 32%, transparent) calc(var(--half-hour-step, 100%) - 1px),
        color-mix(in srgb, white 32%, transparent) var(--half-hour-step, 100%)
      ),
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--hour-step, 100%) - 2px),
        color-mix(in srgb, white 55%, transparent) calc(var(--hour-step, 100%) - 2px),
        color-mix(in srgb, white 55%, transparent) var(--hour-step, 100%)
      );

    box-shadow: 0 0 8px color-mix(in srgb, var(--color-green) 55%, transparent);
  }

  .empty-state {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }
</style>