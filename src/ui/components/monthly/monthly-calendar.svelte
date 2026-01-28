<script lang="ts">
  import type { Moment } from "moment";
  import { onMount, onDestroy } from "svelte";
  import { derived, writable } from "svelte/store";

  import { getObsidianContext } from "../../../context/obsidian-context";
  import { selectListProps } from "../../../redux/dataview/dataview-slice";
  import {
    calculateDailyActivityDurations,
    calculateWeeklyActivityDurations,
    formatDuration,
    getWeekRangeFor,
    type ActivityDuration,
  } from "../../../util/activity-log-summary";
  import type { Activity } from "../../../util/props";
  import {
    extractActivityGoals,
    mergeActivityDurationsWithGoals,
    type ActivityGoal,
  } from "../../../util/weekly-activity-goals";

  let offIndexReady: any;
  let offMetadataChange: any;

  onMount(() => {
    const app = (window as any).app;

    offIndexReady = app?.metadataCache?.on("dataview:index-ready", () => {
      // rerun once the index is ready
      void loadGoalsForWeeks($weeks);
    });

    offMetadataChange = app?.metadataCache?.on("dataview:metadata-change", () => {
      // rerun when DV updates metadata for any file
      void loadGoalsForWeeks($weeks);
    });
  });

  onDestroy(() => {
    const app = (window as any).app;
    if (offIndexReady) app?.metadataCache?.offref(offIndexReady);
    if (offMetadataChange) app?.metadataCache?.offref(offMetadataChange);
  });

  const { useSelector, workspaceFacade, periodicNotes } = getObsidianContext();

  const listProps = useSelector(selectListProps);
  const currentMonth = writable(window.moment().startOf("month"));

  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    window.moment().isoWeekday(index + 1).format("ddd"),
  );

  const activities = derived(listProps, ($listProps) =>
    Object.values($listProps).flatMap((lineToProps) =>
      Object.values(lineToProps).flatMap(
        ({ parsed }) => (parsed.activities as Activity[]) ?? [],
      ),
    ),
  );

  const monthLabel = derived(currentMonth, ($month) => $month.format("MMMM YYYY"));

  const weeks = derived(currentMonth, ($month) => buildWeeks($month));
  const weeklyGoals = writable(new Map<number, ActivityGoal[]>());

  const calendar = derived(
    [weeks, activities, currentMonth, weeklyGoals],
    ([$weeks, $activities, $month, $weeklyGoals]) =>
      $weeks.map((weekStart) => {
        const { end: weekEnd } = getWeekRangeFor(weekStart);
        const weekTotals = calculateWeeklyActivityDurations($activities, weekStart);
        const goalsForWeek =
          $weeklyGoals.get(weekStart.valueOf()) ?? ([] as ActivityGoal[]);

        const days = Array.from({ length: 7 }).map((_, index) => {
          const date = weekStart.clone().add(index, "day");

          return {
            date,
            inCurrentMonth: date.isSame($month, "month"),
            isToday: date.isSame(window.moment(), "day"),
            totals: calculateDailyActivityDurations($activities, date),
          };
        });

        return {
          weekStart,
          weekEnd,
          weekTotals: mergeActivityDurationsWithGoals(weekTotals, goalsForWeek),
          days,
        };
      }),
  );

  type SummaryRow = ActivityDuration & {
    isPlaceholder: boolean;
    goal?: import("moment").Duration;
  };

  function buildWeeks(month: Moment) {
    const start = month.clone().startOf("month").startOf("isoWeek");
    const end = month.clone().endOf("month").endOf("isoWeek");
    const weeks: Moment[] = [];
    let cursor = start.clone();

    while (cursor.isBefore(end)) {
      weeks.push(cursor.clone());
      cursor = cursor.clone().add(1, "week");
    }

    return weeks;
  }

  function goToPreviousMonth() {
    currentMonth.update((month) => month.clone().subtract(1, "month"));
  }

  function goToNextMonth() {
    currentMonth.update((month) => month.clone().add(1, "month"));
  }

  function goToCurrentMonth() {
    currentMonth.set(window.moment().startOf("month"));
  }

  function renderSummary(
    entries: Array<ActivityDuration & { goal?: import("moment").Duration }>,
  ): SummaryRow[] {
    if (entries.length === 0) {
      return [
        {
          activity: "No activity",
          activityKey: "no-activity",
          duration: window.moment.duration(0),
          isPlaceholder: true,
        },
      ];
    }

    const rows: SummaryRow[] = entries.map((entry) => ({
      ...entry,
      isPlaceholder: false,
    }));

    rows.sort((a, b) => {
      const aHasGoal = Boolean(a.goal);
      const bHasGoal = Boolean(b.goal);

      // Goal-tracked activities first, sorted by % complete (descending)
      if (aHasGoal && bHasGoal) {
        const aGoalMs = Math.max(1, a.goal!.asMilliseconds());
        const bGoalMs = Math.max(1, b.goal!.asMilliseconds());
        const aRatio = a.duration.asMilliseconds() / aGoalMs;
        const bRatio = b.duration.asMilliseconds() / bGoalMs;

        if (Math.abs(aRatio - bRatio) > 1e-9) return aRatio - bRatio;

        // tie-break: alphabetically
        return a.activity.localeCompare(b.activity, undefined, { sensitivity: "base" });
      }

      // Goals before non-goals
      if (aHasGoal !== bHasGoal) return aHasGoal ? -1 : 1;

      // No goals: sort by time spent (descending)
      const aMs = a.duration.asMilliseconds();
      const bMs = b.duration.asMilliseconds();
      if (aMs !== bMs) return bMs - aMs;

      // tie-break: alphabetically
      return a.activity.localeCompare(b.activity, undefined, { sensitivity: "base" });
    });

    return rows;
  }

  // Progress bar vars (weekly goals)
  function goalVars(duration: import("moment").Duration, goal: import("moment").Duration) {
    const d = Math.max(0, duration.asMilliseconds());
    const g = Math.max(1, goal.asMilliseconds());
    const ratio = d / g;
    const p = Math.min(1, ratio); // 0..1
    const o = Math.max(0, Math.min(1, ratio - 1)); // 0..1 overflow
    return `--p:${p}; --o:${o};`;
  }

  function hasOverflow(duration: import("moment").Duration, goal: import("moment").Duration) {
    return duration.asMilliseconds() > goal.asMilliseconds();
  }

  let weeklyGoalsRunId = 0;

  $: if (Array.isArray($weeks) && $weeks.length) {
    void loadGoalsForWeeks($weeks).catch((err) =>
      console.error("loadGoalsForWeeks failed", err),
    );
  }

  async function loadGoalsForWeeks(weeksToLoad: ReturnType<typeof buildWeeks>) {
    const thisRunId = ++weeklyGoalsRunId;

    if (!periodicNotes.hasWeeklyNotesSupport()) {
      weeklyGoals.set(new Map());
      return;
    }

    const app = (window as any).app;
    if (!app) {
      weeklyGoals.set(new Map());
      return;
    }

    const goals = await Promise.all(
      weeksToLoad.map(async (weekStart) => {
        const weeklyNote = periodicNotes.getWeeklyNote(weekStart);
        if (!weeklyNote) return null;

        try {
          return {
            key: weekStart.valueOf(),
            goals: await extractActivityGoals(app, weeklyNote),
          };
        } catch (error) {
          console.error("Failed to read weekly note", error);
          return null;
        }
      }),
    );

    if (thisRunId !== weeklyGoalsRunId) return;

    weeklyGoals.set(
      new Map(
        goals
          .filter((it): it is { key: number; goals: ActivityGoal[] } => Boolean(it))
          .map((it) => [it.key, it.goals]),
      ),
    );
  }

  async function openDailyNote(day: Moment) {
    await workspaceFacade.openFileForDay(day);
  }

  async function openWeeklyNote(weekStart: Moment) {
    try {
      const weeklyNote = await periodicNotes.createWeeklyNoteIfNeeded(weekStart);
      if (weeklyNote) {
        await workspaceFacade.openFileInEditor(weeklyNote);
      }
    } catch (error) {
      console.error("Failed to create weekly note", error);
    }
  }

  function handleKeyboardOpen(event: KeyboardEvent, openFn: () => Promise<void> | void) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void openFn();
    }
  }
</script>

<div class="calendar-shell">
  <div class="calendar-header">
    <div class="navigation">
      <button aria-label="Previous month" class="ghost" on:click={goToPreviousMonth}>
        ←
      </button>
      <button aria-label="Jump to current month" class="ghost" on:click={goToCurrentMonth}>
        Today
      </button>
      <button aria-label="Next month" class="ghost" on:click={goToNextMonth}>
        →
      </button>
    </div>

    <div class="month-label">
      {$monthLabel}
    </div>

    <div class="header-spacer" aria-hidden="true"></div>
  </div>

  <div class="calendar-grid">
    <div class="grid-header week-column">Week</div>
    {#each weekdayLabels as label}
      <div class="grid-header">{label}</div>
    {/each}

    {#each $calendar as week (week.weekStart.valueOf())}
      <div
        class="week-summary"
        role="button"
        tabindex="0"
        on:click={() => openWeeklyNote(week.weekStart)}
        on:keydown={(event) => handleKeyboardOpen(event, () => openWeeklyNote(week.weekStart))}
      >
        <div class="cell-header week-header">
          <span class="week-label">
            {week.weekStart.format("MMM D")} – {week.weekEnd.clone().subtract(1, "day").format("MMM D")}
          </span>
        </div>
        <div class="summary-list">
          {#each renderSummary(week.weekTotals) as entry (entry.activity)}
            <div class="summary-row" class:placeholder={entry.isPlaceholder}>
              <div class="summary-activity">
                <span class="summary-name">{entry.activity}</span>
              </div>
              <span class="summary-duration">
                {entry.isPlaceholder
                  ? ""
                  : entry.goal
                    ? `${formatDuration(entry.duration)} / ${formatDuration(entry.goal)}`
                    : formatDuration(entry.duration)}
              </span>

              {#if !entry.isPlaceholder && entry.goal}
                <div
                  class="goal-bar"
                  class:overflow={hasOverflow(entry.duration, entry.goal)}
                  style={goalVars(entry.duration, entry.goal)}
                  aria-hidden="true"
                ></div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      {#each week.days as day (day.date.valueOf())}
        <div
          class="day-cell"
          class:outside-month={!day.inCurrentMonth}
          class:is-today={day.isToday}
          role="button"
          tabindex="0"
          on:click={() => openDailyNote(day.date)}
          on:keydown={(event) => handleKeyboardOpen(event, () => openDailyNote(day.date))}
        >
          <div class="cell-header day-header">
            <span class="day-number">{day.date.date()}</span>
          </div>
          <div class="summary-list">
            {#each renderSummary(day.totals) as entry (entry.activity)}
              <div class="summary-row day" class:placeholder={entry.isPlaceholder}>
                <div class="summary-activity">
                  <span class="summary-name">{entry.activity}</span>
                </div>
                <span class="summary-duration">
                  {entry.isPlaceholder ? "" : formatDuration(entry.duration)}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .calendar-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--size-4-4);
    gap: var(--size-4-3);

    /* Header tint (based on theme accent) */
    --calendar-header-row-bg: color-mix(
      in srgb,
      var(--background-secondary) 86%,
      var(--interactive-accent) 14%
    );
    
    /* Cell header band (subtle neutral tint; no accent) */
    --calendar-cell-header-bg: color-mix(
      in srgb,
      var(--background-secondary) 92%,
      var(--background-modifier-border) 8%
    );
  }

  .calendar-header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--size-4-3);
  }

  .navigation {
    justify-self: start;
    display: flex;
    gap: var(--size-4-2);
  }

  .header-spacer {
    justify-self: end;
  }

  .month-label {
    justify-self: center;
    text-align: center;
    font-weight: 800;
    font-size: calc(var(--font-ui-large) * 1.45);
    line-height: 1.1;
    letter-spacing: 0.01em;
  }

  button.ghost {
    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: var(--size-4-1) var(--size-4-2);
    cursor: pointer;
  }

  button.ghost:hover {
    background: var(--background-secondary);
  }

  button.ghost:active {
    background: var(--background-modifier-hover);
  }

  button.ghost:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--interactive-accent);
  }

  .month-label {
    justify-self: center;
    text-align: center;
    font-weight: 700;
    font-size: calc(var(--font-ui-large) * 1.35);
    line-height: 1.1;
    letter-spacing: 0.01em;
  }

  /* Single-table grid (no gaps) */
  .calendar-grid {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) repeat(7, 1fr);

    gap: 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    overflow: hidden;

    background: var(--background-primary);
  }

  .grid-header {
    font-weight: 700;
    color: var(--text-normal);
    padding: var(--size-4-2);

    /* subtle accent tint */
    background: color-mix(
      in srgb,
      var(--background-secondary) 86%,
      var(--interactive-accent) 14%
    );
    border-bottom-color: color-mix(
      in srgb,
      var(--background-modifier-border) 85%,
      var(--interactive-accent) 15%
    );

    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;

    border-right: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  /* Cells */
  .week-summary,
  .day-cell {
    position: relative;
    padding: var(--size-4-2);
    background: var(--background-primary);
    display: flex;
    flex-direction: column;
    gap: var(--size-2-3);
    min-height: 120px;
    cursor: pointer;

    border-right: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  /* Remove right border on last column */
  .calendar-grid > :nth-child(8n) {
    border-right: 0;
  }

  /* Remove bottom border on last row (last 8 cells) */
  .calendar-grid > :nth-last-child(-n + 8) {
    border-bottom: 0;
  }

  .week-summary:hover,
  .day-cell:hover {
    background: var(--background-secondary);
  }

  .week-summary:active,
  .day-cell:active {
    background: var(--background-modifier-hover);
  }

  .week-label {
    font-weight: 650;
    color: var(--text-normal);
    text-align: center;
    width: 100%;
  }

  .cell-header {
    display: flex;
    align-items: center;
    justify-content: center;

    /* full-bleed header inside padded cell */
    margin: calc(var(--size-4-2) * -1) calc(var(--size-4-2) * -1) 0 calc(var(--size-4-2) * -1);
    padding: var(--size-2-2) var(--size-4-2);

    background: var(--calendar-cell-header-bg, var(--background-secondary));
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .day-number {
    font-size: var(--font-ui-medium);
  }

  .summary-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
    overflow-y: auto;
    max-height: 240px;
  }

  /* Summary rows (week goals) support a progress bar */
  .summary-row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "name dur"
      "bar  bar";
    column-gap: var(--size-2-3);
    row-gap: var(--size-2-1);
    font-size: var(--font-ui-smaller);
    align-items: start;
  }

  /* Day rows don't need the second line (bar), keep them simpler */
  .summary-row.day {
    grid-template-areas: "name dur";
    row-gap: 0;
  }

  .summary-row.placeholder {
    color: var(--text-faint);
  }

  .summary-activity {
    grid-area: name;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    min-width: 0;
  }

  .summary-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-duration {
    grid-area: dur;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .goal-bar {
    grid-area: bar;
    height: 6px;
    border-radius: 999px;
    background: var(--background-modifier-border);
    position: relative;
    overflow: hidden;
  }

  .goal-bar::before {
    content: "";
    position: absolute;
    inset: 0;
    width: calc(var(--p) * 100%);
    background: var(--interactive-accent);
    border-radius: 999px;
    box-shadow: 0 0 10px color-mix(in srgb, var(--interactive-accent) 60%, transparent);
  }

  .goal-bar.overflow::after {
    content: "";
    position: absolute;
    inset: 0;
    left: auto;
    width: calc(var(--o) * 100%);
    background: var(--color-green, var(--interactive-accent));
    border-radius: 999px;
    box-shadow: 0 0 12px color-mix(in srgb, var(--color-green, var(--interactive-accent)) 70%, transparent);
  }

  .outside-month {
    background: var(--background-secondary);
    color: var(--text-faint);
  }

  .outside-month .day-number {
    color: var(--text-muted);
  }

  .is-today {
    /* (highlight is drawn via ::after so it stays visible above the header band) */
  }

  .day-cell.is-today::after {
    content: "";
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 2px var(--interactive-accent);
    pointer-events: none;
    z-index: 3;
  }

  .week-column {
    text-align: center;
  }

  .day-cell:focus-visible,
  .week-summary:focus-visible {
    outline: none;
  }

  .day-cell:focus-visible::after,
  .week-summary:focus-visible::after {
    content: "";
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 2px var(--interactive-accent);
    pointer-events: none;
    z-index: 4;
  }

  .day-cell:focus-visible::after,
  .week-summary:focus-visible::after {
    content: "";
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 2px var(--interactive-accent);
    pointer-events: none;
    z-index: 4;
  }
</style>
