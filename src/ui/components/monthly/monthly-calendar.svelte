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

  const weekdayLabels = window.moment.weekdaysShort(true);

  const activities = derived(listProps, ($listProps) =>
    Object.values($listProps).flatMap((lineToProps) =>
      Object.values(lineToProps).flatMap(
        ({ parsed }) => (parsed.activities as Activity[]) ?? [],
      ),
    ),
  );

  const monthLabel = derived(currentMonth, ($month) =>
    $month.format("MMMM YYYY"),
  );

  const weeks = derived(currentMonth, ($month) => buildWeeks($month));
  const weeklyGoals = writable(new Map<number, ActivityGoal[]>());

  const calendar = derived(
    [weeks, activities, currentMonth, weeklyGoals],
    ([$weeks, $activities, $month, $weeklyGoals]) =>
      $weeks.map((weekStart) => {
        const { end: weekEnd } = getWeekRangeFor(weekStart);
        const weekTotals = calculateWeeklyActivityDurations(
          $activities,
          weekStart,
        );
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
    const start = month.clone().startOf("month").startOf("week");
    const end = month.clone().endOf("month").endOf("week");
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

  function renderSummary(entries: Array<ActivityDuration & { goal?: import("moment").Duration }>): SummaryRow[] {
    if (entries.length === 0) {
      return [
        {
          activity: "No activity",
          duration: window.moment.duration(0),
          isPlaceholder: true,
        },
      ];
    }

    return entries.map((entry) => ({ ...entry, isPlaceholder: false }));
  }

  let weeklyGoalsRunId = 0;

  $: if (Array.isArray($weeks) && $weeks.length) {
    void loadGoalsForWeeks($weeks).catch((err) =>
      console.error("loadGoalsForWeeks failed", err),
    );
  }

  async function loadGoalsForWeeks(weeksToLoad: ReturnType<typeof buildWeeks>) {
    console.log("Loading Goals For Weeks");
    const thisRunId = ++weeklyGoalsRunId;

    if (!periodicNotes.hasWeeklyNotesSupport()) {
      weeklyGoals.set(new Map());
      console.log("Weekly notes not supported/enabled");
      return;
    }

    const app = (window as any).app; // ✅ avoid TS Window typing issues
    if (!app) {
      weeklyGoals.set(new Map());
      console.log("No app");
      return;
    }

    const goals = await Promise.all(
      weeksToLoad.map(async (weekStart) => {
        console.log("- Checking weekly note for " + weekStart.format());
        const weeklyNote = periodicNotes.getWeeklyNote(weekStart);

        if (!weeklyNote) {
          console.log("XX No weekly note for " + weekStart.format());
          return null;
        }

        try {
          return {
            key: weekStart.valueOf(),
            goals: await extractActivityGoals(app, weeklyNote), // ✅ await
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
      console.log("Creating Weekly Note: " + weekStart);
      const weeklyNote = await periodicNotes.createWeeklyNoteIfNeeded(weekStart); 
      if (weeklyNote) {
        await workspaceFacade.openFileInEditor(weeklyNote);
      }
    } catch(error) {
      console.error("Failed to create weekly note", error);
    }
  }

  function handleKeyboardOpen(
    event: KeyboardEvent,
    openFn: () => Promise<void> | void,
  ) {
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
  </div>

  <div class="calendar-grid">
    <div class="grid-header week-column">Week</div>
    {#each weekdayLabels as label}
      <div class="grid-header">
        {label}
      </div>
    {/each}

    {#each $calendar as week (week.weekStart.valueOf())}
      <div
        class="week-summary"
        role="button"
        tabindex="0"
        on:click={() => openWeeklyNote(week.weekStart)}
        on:keydown={(event) => handleKeyboardOpen(event, () => openWeeklyNote(week.weekStart))}
      >
        <div class="week-label">
          {week.weekStart.format("MMM D")} – {week.weekEnd.clone().subtract(1, "day").format("MMM D")}
        </div>
        <div class="summary-list">
          {#each renderSummary(week.weekTotals) as entry (entry.activity)}
            <div class="summary-row" class:placeholder={entry.isPlaceholder}>
              <div class="summary-activity">
                <span class="summary-name">{entry.activity}</span>
                {#if entry.goal}
                  <span class="summary-goal">Goal {formatDuration(entry.goal)}</span>
                {/if}
              </div>
              <span class="summary-duration">{entry.isPlaceholder ? "" : formatDuration(entry.duration)}</span>
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
          <div class="day-heading">
            <span class="day-number">{day.date.date()}</span>
          </div>
          <div class="summary-list">
            {#each renderSummary(day.totals) as entry (entry.activity)}
              <div class="summary-row" class:placeholder={entry.isPlaceholder}>
                <div class="summary-activity">
                  <span class="summary-name">{entry.activity}</span>
                </div>
                <span class="summary-duration">{entry.isPlaceholder ? "" : formatDuration(entry.duration)}</span>
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
  }

  .calendar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-3);
  }

  .navigation {
    display: flex;
    gap: var(--size-4-2);
  }

  button.ghost {
    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: var(--size-4-1) var(--size-4-2);
    cursor: pointer;
  }

  .month-label {
    font-weight: 600;
    font-size: var(--font-ui-large);
  }

  .calendar-grid {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) repeat(7, 1fr);
    gap: var(--size-4-3);
    align-items: start;
  }

  .grid-header {
    font-weight: 600;
    color: var(--text-muted);
    padding-bottom: var(--size-4-1);
  }

  .week-summary,
  .day-cell {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: var(--size-4-2);
    background: var(--background-primary);
    display: flex;
    flex-direction: column;
    gap: var(--size-2-3);
    min-height: 120px;
    cursor: pointer;
  }

  .week-label {
    font-weight: 600;
    color: var(--text-normal);
  }

  .day-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
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

  .summary-row {
    display: flex;
    justify-content: space-between;
    gap: var(--size-2-3);
    font-size: var(--font-ui-smaller);
    align-items: flex-start;
  }

  .summary-row.placeholder {
    color: var(--text-faint);
  }

  .summary-activity {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }

  .summary-duration {
    white-space: nowrap;
  }

  .summary-goal {
    color: var(--text-muted);
  }

  .outside-month {
    opacity: 0.6;
    background: var(--background-secondary);
  }

  .is-today {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .week-column {
    text-align: left;
  }

  .day-cell:focus-visible,
  .week-summary:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }
</style>
