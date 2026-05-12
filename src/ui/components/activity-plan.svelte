<script lang="ts">
  import type { App } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import type { PeriodicNotes } from "../../service/periodic-notes";
  import {
    getActivityDefinition,
    getActivityDefinitions,
    normalizeActivityName,
  } from "../../util/activity-definitions";
  import { getWeekRangeFor } from "../../util/activity-log-summary";
  import {
    extractActivityPlanEntries,
    upsertActivityPlanEntryInMarkdown,
    type ActivityPlanEntryKind,
  } from "../../util/weekly-activity-goals";

  type ActivityPlanItem = {
    name: string;
    defaultHours: number;
    maxHours?: number;
    intervalMinutes?: number;
  };

  type ActivityPlanState = {
    activity: string;
    hours: number;
    kind: ActivityPlanEntryKind;
    sourceLine?: number;
  };

  type DataviewMetadataCache = {
    on?: (name: "dataview:metadata-change", callback: () => void) => unknown;
    offref?: (ref: unknown) => void;
  };

  let { app, periodicNotes }: { app: App; periodicNotes: PeriodicNotes } =
    $props();

  const defaultMaxHours = 40;
  const defaultIntervalMinutes = 60;
  const weeklyHours = 168;
  const defaultActivityPlanItems: ActivityPlanItem[] =
    getActivityDefinitions().flatMap((definition) => {
      if (!definition.plan) return [];

      return [
        {
          name: definition.name,
          defaultHours: definition.plan.defaultHours,
          maxHours: definition.plan.maxHours,
          intervalMinutes: definition.plan.intervalMinutes,
        },
      ];
    });

  const defaultHoursByActivity = Object.fromEntries(
    defaultActivityPlanItems.map(({ name, defaultHours }) => [
      normalizeActivityName(name),
      defaultHours,
    ]),
  );

  let activityPlanItems = $state<ActivityPlanItem[]>(defaultActivityPlanItems);
  let planByActivity = $state<Record<string, ActivityPlanState>>(
    Object.fromEntries(
      defaultActivityPlanItems.map(({ name, defaultHours }) => [
        normalizeActivityName(name),
        { activity: name, hours: defaultHours, kind: "estimate" },
      ]),
    ),
  );
  let isWeeklyNotesEnabled = $state(true);
  let weekLabel = $state("");
  let statusMessage = $state("");

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let offMetadataChange: unknown;

  let totalHours = $derived(
    activityPlanItems.reduce((total, item) => {
      const key = normalizeActivityName(item.name);
      return total + (planByActivity[key]?.hours ?? 0);
    }, 0),
  );
  let remainingHours = $derived(weeklyHours - totalHours);

  function getLabel(name: string) {
    return getActivityDefinition(name)?.label ?? name;
  }

  function getEmoji(name: string) {
    return getActivityDefinition(name)?.emoji;
  }

  function getMaxHours(item: ActivityPlanItem) {
    return item.maxHours ?? defaultMaxHours;
  }

  function getIntervalHours(item: ActivityPlanItem) {
    return (item.intervalMinutes ?? defaultIntervalMinutes) / 60;
  }

  function getSliderFillPercent(hours: number, maxHours: number) {
    return Math.max(0, Math.min(100, (hours / maxHours) * 100));
  }

  function formatHours(hours: number) {
    return Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
  }

  function mergePlanEntries(
    entries: ReturnType<typeof extractActivityPlanEntries>,
  ) {
    const nextPlanByActivity: Record<string, ActivityPlanState> = {
      ...Object.fromEntries(
        defaultActivityPlanItems.map(({ name, defaultHours }) => [
          normalizeActivityName(name),
          { activity: name, hours: defaultHours, kind: "estimate" },
        ]),
      ),
    };
    const nextItems = [...defaultActivityPlanItems];
    const seenItems = new Set(
      nextItems.map(({ name }) => normalizeActivityName(name)),
    );

    for (const entry of entries) {
      const key = normalizeActivityName(entry.activity);
      nextPlanByActivity[key] = {
        activity: entry.activity,
        hours: entry.duration.asHours(),
        kind: entry.kind,
        sourceLine: entry.sourceLine,
      };

      if (!seenItems.has(key)) {
        nextItems.push({
          name: entry.activity,
          defaultHours: entry.duration.asHours(),
          intervalMinutes: defaultIntervalMinutes,
        });
        seenItems.add(key);
      }
    }

    activityPlanItems = nextItems;
    planByActivity = nextPlanByActivity;
  }

  async function refresh() {
    isWeeklyNotesEnabled = periodicNotes.hasWeeklyNotesSupport();
    const now = window.moment();
    const { start: weekStart, end: weekEnd } = getWeekRangeFor(now);
    weekLabel = `${weekStart.format("MMM D")} – ${weekEnd
      .clone()
      .subtract(1, "day")
      .format("MMM D")}`;

    if (!isWeeklyNotesEnabled) {
      statusMessage =
        "Weekly notes support is required to edit activity plans.";
      return;
    }

    const weekNote = periodicNotes.getWeeklyNote(weekStart);
    if (!weekNote) {
      statusMessage = "No weekly note exists yet; edits will create one.";
      mergePlanEntries([]);
      return;
    }

    mergePlanEntries(extractActivityPlanEntries(app, weekNote));
    statusMessage = "";
  }

  async function saveActivity(key: string) {
    if (!isWeeklyNotesEnabled) return;

    const state = planByActivity[key];
    if (!state) return;

    const { start: weekStart } = getWeekRangeFor(window.moment());
    const weekNote = await periodicNotes.createWeeklyNoteIfNeeded(weekStart);

    if (!weekNote) {
      statusMessage = "Unable to create the weekly note.";
      return;
    }

    const markdown = await app.vault.read(weekNote);
    const result = upsertActivityPlanEntryInMarkdown(markdown, {
      activity: state.activity,
      kind: state.kind,
      duration: window.moment.duration(state.hours, "hours"),
      sourceLine: state.sourceLine,
    });

    await app.vault.modify(weekNote, result.markdown);
    planByActivity = {
      ...planByActivity,
      [key]: {
        ...state,
        sourceLine: result.lineIndex,
      },
    };
    statusMessage = "Saved to this week’s Activity Goals.";
  }

  function setActivityHours(name: string, value: string) {
    const key = normalizeActivityName(name);
    const previous = planByActivity[key] ?? {
      activity: name,
      hours: defaultHoursByActivity[key] ?? 0,
      kind: "estimate",
    };

    planByActivity = {
      ...planByActivity,
      [key]: {
        ...previous,
        hours: Number(value),
      },
    };
  }

  function setActivityKind(name: string, kind: ActivityPlanEntryKind) {
    const key = normalizeActivityName(name);
    const previous = planByActivity[key] ?? {
      activity: name,
      hours: defaultHoursByActivity[key] ?? 0,
      kind: "estimate",
    };

    planByActivity = {
      ...planByActivity,
      [key]: {
        ...previous,
        kind,
      },
    };

    void saveActivity(key).catch((error) => {
      console.error("Failed to save activity kind", error);
      statusMessage = "Failed to save activity kind.";
    });
  }

  function saveActivityByName(name: string) {
    const key = normalizeActivityName(name);
    void saveActivity(key).catch((error) => {
      console.error("Failed to save activity plan", error);
      statusMessage = "Failed to save activity plan.";
    });
  }

  onMount(() => {
    void refresh();

    offMetadataChange = (
      app.metadataCache as unknown as DataviewMetadataCache
    )?.on("dataview:metadata-change", () => {
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

    if (offMetadataChange) {
      (app.metadataCache as unknown as DataviewMetadataCache)?.offref(
        offMetadataChange,
      );
    }
  });
</script>

<div class="activity-plan">
  <div class="activity-plan-header">
    <div>
      <h3>Activity Plan</h3>
      <div class="subtitle">Weekly allocation · {weekLabel}</div>
    </div>
    <div class="remaining" class:over={remainingHours < 0}>
      {formatHours(Math.abs(remainingHours))}h
      {remainingHours < 0 ? "over" : "left"}
    </div>
  </div>

  {#if statusMessage}
    <div class="status-message">{statusMessage}</div>
  {/if}

  <div class="activity-summary">
    <div>
      <span class="summary-label">Planned</span>
      <span class="summary-value">{formatHours(totalHours)}h</span>
    </div>
    <div>
      <span class="summary-label">Per day</span>
      <span class="summary-value">{formatHours(totalHours / 7)}h</span>
    </div>
    <div>
      <span class="summary-label">Week</span>
      <span class="summary-value">{weeklyHours}h</span>
    </div>
  </div>

  <div class="activity-plan-list">
    {#each activityPlanItems as item (normalizeActivityName(item.name))}
      {@const key = normalizeActivityName(item.name)}
      {@const state = planByActivity[key]}
      {@const hours = state?.hours ?? 0}
      {@const kind = state?.kind ?? "estimate"}
      {@const maxHours = getMaxHours(item)}
      {@const intervalHours = getIntervalHours(item)}
      {@const emoji = getEmoji(item.name)}
      <div class="activity-row">
        <div class="activity-row-top">
          <span class="activity-name" class:goal={kind === "goal"}>
            {#if emoji}
              <span class="activity-emoji" aria-hidden="true">{emoji}</span>
            {/if}
            <span>{getLabel(item.name)}</span>
          </span>
          <span class="activity-value" class:goal={kind === "goal"}>
            {formatHours(hours)}h
            <span class="per-day">/ {formatHours(hours / 7)}h day</span>
          </span>
        </div>

        <div class="activity-controls">
          <label class="kind-label">
            <span class="sr-only">Plan type for {getLabel(item.name)}</span>
            <select
              aria-label={`Plan type for ${getLabel(item.name)}`}
              onchange={(event) =>
                setActivityKind(
                  item.name,
                  event.currentTarget.value as ActivityPlanEntryKind,
                )}
              value={kind}
            >
              <option value="estimate">Estimate</option>
              <option value="goal">Goal</option>
            </select>
          </label>

          <input
            style={`--slider-fill:${getSliderFillPercent(hours, maxHours)}%;`}
            aria-label={`Hours for ${getLabel(item.name)}`}
            max={maxHours}
            min="0"
            onchange={() => saveActivityByName(item.name)}
            oninput={(event) =>
              setActivityHours(item.name, event.currentTarget.value)}
            step={intervalHours}
            type="range"
            value={hours}
          />
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .activity-plan {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);

    padding: var(--size-4-3);

    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }

  .activity-plan-header {
    display: flex;
    gap: var(--size-4-3);
    align-items: flex-start;
    justify-content: space-between;
  }

  .activity-plan-header h3 {
    margin: 0;
    font-size: var(--font-ui-large);
    font-weight: 750;
  }

  .subtitle,
  .summary-label,
  .per-day,
  .status-message {
    color: var(--text-muted);
  }

  .subtitle {
    margin-top: 2px;
    font-size: var(--font-ui-smaller);
  }

  .status-message {
    padding: var(--size-2-2) var(--size-4-2);

    font-size: var(--font-ui-small);

    background: var(--background-secondary);
    border-radius: var(--radius-s);
  }

  .remaining {
    flex: 0 0 auto;

    padding: var(--size-2-1) var(--size-4-2);

    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    color: var(--text-accent);

    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .remaining.over {
    color: var(--text-error);
  }

  .activity-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--size-4-2);
  }

  .activity-summary > div {
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding: var(--size-4-2);

    background: var(--background-secondary);
    border-radius: var(--radius-s);
  }

  .summary-label {
    font-size: var(--font-ui-smaller);
  }

  .summary-value {
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
  }

  .activity-plan-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  .activity-row {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
  }

  .activity-row-top {
    display: flex;
    gap: var(--size-4-2);
    align-items: baseline;
    justify-content: space-between;
  }

  .activity-name {
    overflow: hidden;
    display: inline-flex;
    gap: var(--size-2-2);
    align-items: center;

    font-weight: var(--font-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-emoji {
    flex: 0 0 auto;
    font-size: 1.1em;
    line-height: 1;
  }

  .activity-value {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  .activity-name.goal,
  .activity-value.goal,
  .activity-value.goal .per-day {
    color: var(--text-error);
  }

  .per-day {
    font-size: var(--font-ui-smaller);
  }

  .activity-controls {
    display: grid;
    grid-template-columns: minmax(7rem, max-content) minmax(0, 1fr);
    gap: var(--size-4-2);
    align-items: center;
  }

  select {
    width: 100%;
    min-height: 28px;
  }

  .sr-only {
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;
    padding: 0;

    white-space: nowrap;

    border: 0;
    clip: rect(0, 0, 0, 0);
  }

  input[type="range"] {
    cursor: pointer;

    width: 100%;
    height: 18px;
    padding: 0;

    appearance: none;
    accent-color: var(--interactive-accent);
    background: linear-gradient(
      to right,
      var(--interactive-accent) 0%,
      var(--interactive-accent) var(--slider-fill),
      var(--background-modifier-border) var(--slider-fill),
      var(--background-modifier-border) 100%
    );
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 8px;
    border-radius: 999px;
    outline: none;
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 8px;
    background: transparent;
    border-radius: 999px;
  }

  input[type="range"]::-webkit-slider-thumb {
    width: 16px;
    height: 16px;

    appearance: none;
    background: var(--background-primary);
    border: 2px solid var(--interactive-accent);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--background-modifier-border);
  }

  input[type="range"]::-moz-range-track {
    height: 8px;
    background: transparent;
    border-radius: 999px;
  }

  input[type="range"]::-moz-range-progress {
    height: 8px;
    background: var(--interactive-accent);
    border-radius: 999px;
  }

  input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;

    background: var(--background-primary);
    border: 2px solid var(--interactive-accent);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--background-modifier-border);
  }

  @media (width <= 520px) {
    .activity-summary,
    .activity-controls {
      grid-template-columns: 1fr;
    }

    .activity-row-top {
      flex-direction: column;
      gap: 2px;
      align-items: flex-start;
    }
  }
</style>
