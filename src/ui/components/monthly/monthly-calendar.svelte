<script lang="ts">
  import type { Moment } from "moment";
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

  const { useSelector } = getObsidianContext();

  const listProps = useSelector(selectListProps);
  const currentMonth = writable(window.moment().startOf("month"));

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

  const calendar = derived(
    [weeks, activities, currentMonth],
    ([$weeks, $activities, $month]) =>
      $weeks.map((weekStart) => {
        const { end: weekEnd } = getWeekRangeFor(weekStart);
        const weekTotals = calculateWeeklyActivityDurations(
          $activities,
          weekStart,
        );
        const days = Array.from({ length: 7 }).map((_, index) => {
          const date = weekStart.clone().add(index, "day");

          return {
            date,
            inCurrentMonth: date.isSame($month, "month"),
            isToday: date.isSame(window.moment(), "day"),
            totals: calculateDailyActivityDurations($activities, date),
          };
        });

        return { weekStart, weekEnd, weekTotals, days };
      }),
  );

  type SummaryRow = ActivityDuration & { isPlaceholder: boolean };

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

  function renderSummary(entries: ActivityDuration[]): SummaryRow[] {
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
      <div class="week-summary">
        <div class="week-label">
          {week.weekStart.format("MMM D")} – {week.weekEnd.clone().subtract(1, "day").format("MMM D")}
        </div>
        <div class="summary-list">
          {#each renderSummary(week.weekTotals) as entry (entry.activity)}
            <div class="summary-row" class:placeholder={entry.isPlaceholder}>
              <span>{entry.activity}</span>
              <span>{entry.isPlaceholder ? "" : formatDuration(entry.duration)}</span>
            </div>
          {/each}
        </div>
      </div>
      {#each week.days as day (day.date.valueOf())}
        <div
          class="day-cell"
          class:outside-month={!day.inCurrentMonth}
          class:is-today={day.isToday}
        >
          <div class="day-heading">
            <span class="day-number">{day.date.date()}</span>
          </div>
          <div class="summary-list">
            {#each renderSummary(day.totals) as entry (entry.activity)}
              <div class="summary-row" class:placeholder={entry.isPlaceholder}>
                <span>{entry.activity}</span>
                <span>{entry.isPlaceholder ? "" : formatDuration(entry.duration)}</span>
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
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    gap: var(--size-2-3);
    font-size: var(--font-ui-smaller);
  }

  .summary-row.placeholder {
    color: var(--text-faint);
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
</style>
