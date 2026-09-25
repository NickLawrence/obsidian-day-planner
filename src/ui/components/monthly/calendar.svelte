<script lang="ts">
  import type { Moment } from "moment";
  import type { App, EventRef } from "obsidian";
  import { onMount, onDestroy } from "svelte";
  import { derived, writable } from "svelte/store";

  import { getObsidianContext } from "../../../context/obsidian-context";
  import { selectListProps } from "../../../redux/dataview/dataview-slice";
  import { normalizeActivityName } from "../../../util/activity-definitions";
  import {
    calculateDailyActivityDisplayDurations,
    calculateWeeklyActivityDurations,
    getWeekRangeFor,
    type ActivityDuration,
    type ActivityDisplayDuration,
  } from "../../../util/activity-log-summary";
  import { getAllActivitiesFromListProps } from "../../../util/activity-totals";
  import { formatDuration } from "../../../util/duration";
  import type { Activity } from "../../../util/props";
  import {
    extractActivityGoals,
    mergeActivityDurationsWithGoals,
    type ActivityGoal,
  } from "../../../util/weekly-activity-goals";

  export let displayedActivities: string[] | undefined = undefined;
  export let showWeeklyGoals = false;

  type DailyAccentApi = {
    getAccentForDayKey?: (dayKey: string) => {
      css?: string;
    };
  };

  type CalendarApp = App & {
    metadataCache: App["metadataCache"] & {
      on: (event: string, callback: () => void) => EventRef;
    };
    plugins?: {
      getPlugin?: (id: string) => { api?: DailyAccentApi } | undefined;
    };
  };

  const {
    app: obsidianApp,
    useSelector,
    workspaceFacade,
    periodicNotes,
  } = getObsidianContext();

  function getApp() {
    return obsidianApp as CalendarApp;
  }

  let offIndexReady: EventRef | undefined;
  let offMetadataChange: EventRef | undefined;

  onMount(() => {
    const app = getApp();

    offIndexReady = app?.metadataCache?.on("dataview:index-ready", () => {
      // rerun once the index is ready
      void loadGoalsForWeeks($weeks);
    });

    offMetadataChange = app?.metadataCache?.on(
      "dataview:metadata-change",
      () => {
        // rerun when DV updates metadata for any file
        void loadGoalsForWeeks($weeks);
      },
    );
  });

  onDestroy(() => {
    const app = getApp();
    if (offIndexReady) app?.metadataCache?.offref(offIndexReady);
    if (offMetadataChange) app?.metadataCache?.offref(offMetadataChange);
  });

  const listProps = useSelector(selectListProps);
  const currentMonth = writable(window.moment().startOf("month"));
  const displayedActivitiesStore = writable<string[] | undefined>(
    displayedActivities,
  );

  $: displayedActivitiesStore.set(displayedActivities);

  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    window
      .moment()
      .isoWeekday(index + 1)
      .format("ddd"),
  );

  const activities = derived(
    [listProps, displayedActivitiesStore],
    ([$listProps, $displayedActivities]) => {
      const allActivities = getAllActivitiesFromListProps($listProps);
      if (typeof $displayedActivities === "undefined") return allActivities;

      const allowed = new Set($displayedActivities.map(normalizeActivityName));
      return allActivities.filter((activity: Activity) =>
        allowed.has(normalizeActivityName(activity.activity)),
      );
    },
  );

  const monthLabel = derived(currentMonth, ($month) =>
    $month.format("MMMM YYYY"),
  );

  const weeks = derived(currentMonth, ($month) => buildWeeks($month));
  const weeklyGoals = writable(new Map<number, ActivityGoal[]>());

  function getDailyAccentColor(day: Moment) {
    const app = getApp();
    const dailyAccentPlugin = app?.plugins?.getPlugin?.(
      "obsidian-daily-accent",
    ) as { api?: DailyAccentApi } | undefined;

    if (!dailyAccentPlugin) {
      return undefined;
    }

    if (day.isAfter(window.moment(), "day")) {
      return undefined;
    }

    const accentInfo = dailyAccentPlugin.api?.getAccentForDayKey?.(
      day.format("YYYY-MM-DD"),
    );

    return accentInfo?.css;
  }

  const calendar = derived(
    [weeks, activities, currentMonth, weeklyGoals, displayedActivitiesStore],
    ([$weeks, $activities, $month, $weeklyGoals, $displayedActivities]) =>
      $weeks.map((weekStart) => {
        const { end: weekEnd } = getWeekRangeFor(weekStart);
        const weekTotals = calculateWeeklyActivityDurations(
          $activities,
          weekStart,
        );
        const goalsForWeek = (
          $weeklyGoals.get(weekStart.valueOf()) ?? ([] as ActivityGoal[])
        ).filter(
          (goal) =>
            typeof $displayedActivities === "undefined" ||
            $displayedActivities.some(
              (activity) =>
                normalizeActivityName(activity) ===
                normalizeActivityName(goal.activity),
            ),
        );

        // Merge weekly totals with goals first (ensures activityKey matches ActivityDuration keys)
        const weekTotalsWithGoals = mergeActivityDurationsWithGoals(
          weekTotals,
          goalsForWeek,
        );

        // Used to highlight daily rows that are part of this week's goals
        const goalActivityKeys = new Set(
          weekTotalsWithGoals
            .filter((total) => Boolean(total.goal))
            .map((total) => total.activityKey)
            .filter((it): it is string => Boolean(it)),
        );

        const days = Array.from({ length: 7 }).map((_, index) => {
          const date = weekStart.clone().add(index, "day");

          return {
            date,
            accentColor: getDailyAccentColor(date),
            inCurrentMonth: date.isSame($month, "month"),
            isToday: date.isSame(window.moment(), "day"),
            totals: calculateDailyActivityDisplayDurations($activities, date),
          };
        });

        return {
          weekStart,
          weekEnd,
          goalActivityKeys,
          weekTotals: weekTotalsWithGoals,
          days,
        };
      }),
  );

  type SummaryRow = ActivityDuration & {
    isPlaceholder: boolean;
    goal?: import("moment").Duration;
    emoji?: string;
    mainKeyValue?: ActivityDisplayDuration["mainKeyValue"];
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
    entries: Array<
      ActivityDisplayDuration & { goal?: import("moment").Duration }
    >,
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
        return a.activity.localeCompare(b.activity, undefined, {
          sensitivity: "base",
        });
      }

      // Goals before non-goals
      if (aHasGoal !== bHasGoal) return aHasGoal ? -1 : 1;

      // No goals: sort by time spent (descending)
      const aMs = a.duration.asMilliseconds();
      const bMs = b.duration.asMilliseconds();
      if (aMs !== bMs) return bMs - aMs;

      // tie-break: alphabetically
      return a.activity.localeCompare(b.activity, undefined, {
        sensitivity: "base",
      });
    });

    return rows;
  }

  // Progress bar vars (weekly goals)
  function goalVars(
    duration: import("moment").Duration,
    goal: import("moment").Duration,
  ) {
    const d = Math.max(0, duration.asMilliseconds());
    const g = Math.max(1, goal.asMilliseconds());
    const ratio = d / g;
    const p = Math.min(1, ratio); // 0..1
    const o = Math.max(0, Math.min(1, ratio - 1)); // 0..1 overflow
    return `--p:${p}; --o:${o};`;
  }

  function hasOverflow(
    duration: import("moment").Duration,
    goal: import("moment").Duration,
  ) {
    return duration.asMilliseconds() > goal.asMilliseconds();
  }

  let weeklyGoalsRunId = 0;

  $: if (showWeeklyGoals && Array.isArray($weeks) && $weeks.length) {
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

    const app = getApp();
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
          .filter((it): it is { key: number; goals: ActivityGoal[] } =>
            Boolean(it),
          )
          .map((it) => [it.key, it.goals]),
      ),
    );
  }

  async function openDailyNote(day: Moment) {
    await workspaceFacade.openFileForDay(day);
  }

  async function openWeeklyNote(weekStart: Moment) {
    try {
      const weeklyNote =
        await periodicNotes.createWeeklyNoteIfNeeded(weekStart);
      if (weeklyNote) {
        await workspaceFacade.openFileInEditor(weeklyNote);
      }
    } catch (error) {
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
      <button
        class="ghost"
        aria-label="Previous month"
        on:click={goToPreviousMonth}
      >
        ←
      </button>
      <button
        class="ghost"
        aria-label="Jump to current month"
        on:click={goToCurrentMonth}
      >
        Today
      </button>
      <button class="ghost" aria-label="Next month" on:click={goToNextMonth}>
        →
      </button>
    </div>

    <div class="month-label">
      {$monthLabel}
    </div>

    <div class="header-spacer" aria-hidden="true"></div>
  </div>

  <div class="calendar-grid" class:with-weekly-goals={showWeeklyGoals}>
    {#if showWeeklyGoals}
      <div class="grid-header week-column">Week</div>
    {/if}
    {#each weekdayLabels as label}
      <div class="grid-header">{label}</div>
    {/each}

    {#each $calendar as week (week.weekStart.valueOf())}
      {#if showWeeklyGoals}
        <div
          class="week-summary"
          role="button"
          tabindex="0"
          on:click={() => openWeeklyNote(week.weekStart)}
          on:keydown={(event) =>
            handleKeyboardOpen(event, () => openWeeklyNote(week.weekStart))}
        >
          <div class="cell-header week-header">
            <span class="week-label">
              {week.weekStart.format("MMM D")} – {week.weekEnd
                .clone()
                .subtract(1, "day")
                .format("MMM D")}
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
                    style={goalVars(entry.duration, entry.goal)}
                    class="goal-bar"
                    class:overflow={hasOverflow(entry.duration, entry.goal)}
                    aria-hidden="true"
                  ></div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#each week.days as day (day.date.valueOf())}
        <div
          class="day-cell"
          class:is-today={day.isToday}
          class:outside-month={!day.inCurrentMonth}
          role="button"
          tabindex="0"
          on:click={() => openDailyNote(day.date)}
          on:keydown={(event) =>
            handleKeyboardOpen(event, () => openDailyNote(day.date))}
        >
          <div class="cell-header day-header">
            {#if day.accentColor}
              <span
                style={`--daily-accent-color: ${day.accentColor};`}
                class="daily-accent-dot"
                aria-hidden="true"
              ></span>
            {/if}
            <span class="day-number">{day.date.date()}</span>
          </div>
          <div class="summary-list">
            {#each renderSummary(day.totals) as entry (`${entry.activityKey}:${entry.mainKeyValue ?? ""}`)}
              <div
                class="summary-row day"
                class:goal-match={!entry.isPlaceholder &&
                  week.goalActivityKeys.has(entry.activityKey)}
                class:placeholder={entry.isPlaceholder}
              >
                <div class="summary-activity">
                  <span class="summary-name"
                    >{entry.mainKeyValue !== undefined && entry.emoji
                      ? `${entry.emoji} ${entry.activity}`
                      : entry.activity}</span
                  >
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

    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);

    height: 100%;
    padding: var(--size-4-4);
  }

  .calendar-header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: var(--size-4-3);
    align-items: center;
  }

  .navigation {
    display: flex;
    gap: var(--size-4-2);
    justify-self: start;
  }

  .header-spacer {
    justify-self: end;
  }

  button.ghost {
    cursor: pointer;

    padding: var(--size-4-1) var(--size-4-2);

    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
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

    font-size: calc(var(--font-ui-large) * 1.35);
    font-weight: 700;
    line-height: 1.1;
    text-align: center;
    letter-spacing: 0.01em;
  }

  /* Single-table grid (no gaps) */
  .calendar-grid {
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0;

    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .calendar-grid.with-weekly-goals {
    grid-template-columns: minmax(220px, 1fr) repeat(7, minmax(0, 1fr));
  }

  .grid-header {
    display: flex;
    align-items: center;
    justify-content: center;

    padding: var(--size-4-2);

    font-weight: 700;
    color: var(--text-normal);
    text-align: center;

    /* subtle accent tint */
    background: color-mix(
      in srgb,
      var(--background-secondary) 86%,
      var(--interactive-accent) 14%
    );
    border-right: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
    border-bottom-color: color-mix(
      in srgb,
      var(--background-modifier-border) 85%,
      var(--interactive-accent) 15%
    );
  }

  /* Cells */
  .week-summary,
  .day-cell {
    cursor: pointer;

    position: relative;

    display: flex;
    flex-direction: column;
    gap: var(--size-2-3);

    min-height: 120px;
    padding: var(--size-4-2);

    background: var(--background-primary);
    border-right: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  /* Remove right border on last column */
  .calendar-grid.with-weekly-goals > :nth-child(8n) {
    border-right: 0;
  }

  .calendar-grid:not(.with-weekly-goals) > :nth-child(7n) {
    border-right: 0;
  }

  /* Remove bottom border on last row (last 8 cells) */
  .calendar-grid.with-weekly-goals > :nth-last-child(-n + 8) {
    border-bottom: 0;
  }

  .calendar-grid:not(.with-weekly-goals) > :nth-last-child(-n + 7) {
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
    width: 100%;
    font-weight: 650;
    color: var(--text-normal);
    text-align: center;
  }

  .cell-header {
    display: flex;
    align-items: center;
    justify-content: center;

    /* full-bleed header inside padded cell */
    margin: calc(var(--size-4-2) * -1) calc(var(--size-4-2) * -1) 0;
    padding: var(--size-2-2) var(--size-4-2);

    background: var(--calendar-cell-header-bg, var(--background-secondary));
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .day-header {
    position: relative;
    justify-content: center;
  }

  .daily-accent-dot {
    position: absolute;
    top: 50%;
    inset-inline-start: var(--size-4-2);
    transform: translateY(-50%);

    width: 1.25em;
    height: 1.25em;

    background: var(--daily-accent-color);
    border: 1px solid
      color-mix(
        in srgb,
        var(--daily-accent-color) 80%,
        var(--background-modifier-border)
      );
    border-radius: 999px;
  }

  .day-number {
    font-size: var(--font-ui-medium);
  }

  .summary-list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);

    max-height: 240px;
  }

  /* Summary rows (week goals) support a progress bar */
  .summary-row {
    display: grid;
    grid-template-areas:
      "name dur"
      "bar  bar";
    grid-template-columns: 1fr auto;
    gap: var(--size-2-1) var(--size-2-3);
    align-items: start;

    font-size: var(--font-ui-smaller);
  }

  /* Day rows don't need the second line (bar), keep them simpler */
  .summary-row.day {
    grid-template-areas: "name dur";
    row-gap: 0;
    align-items: center;
  }

  /* Daily activity matches a weekly goal */
  .summary-row.day.goal-match {
    padding: 2px 6px;

    /* Accent-tinted pill background */
    background: color-mix(
      in srgb,
      var(--interactive-accent) 18%,
      var(--background-primary)
    );
    border: 1px solid
      color-mix(
        in srgb,
        var(--interactive-accent) 28%,
        var(--background-modifier-border)
      );
    border-radius: var(--radius-l);
  }

  .summary-row.placeholder {
    color: var(--text-faint);
  }

  .summary-activity {
    display: flex;
    grid-area: name;
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
    color: var(--text-muted);
    white-space: nowrap;
  }

  .summary-row.day.goal-match .summary-duration {
    color: var(--text-normal);
  }

  .goal-bar {
    position: relative;

    overflow: hidden;
    grid-area: bar;

    height: 6px;

    background: var(--background-modifier-border);
    border-radius: 999px;
  }

  .goal-bar::before {
    content: "";

    position: absolute;
    inset: 0;

    width: calc(var(--p) * 100%);

    background: var(--interactive-accent);
    border-radius: 999px;
    box-shadow: 0 0 10px
      color-mix(in srgb, var(--interactive-accent) 60%, transparent);
  }

  .goal-bar.overflow::after {
    content: "";

    position: absolute;
    inset: 0 auto 0 0;

    width: calc(var(--o) * 100%);

    background: color-mix(in srgb, var(--interactive-accent) 60%, black);
    border-radius: 999px;
    box-shadow: 0 0 12px
      color-mix(
        in srgb,
        color-mix(in srgb, var(--interactive-accent) 60%, black) 70%,
        transparent
      );
  }

  .outside-month {
    color: var(--text-faint);
    background: var(--background-secondary);
  }

  .outside-month .day-number {
    color: var(--text-muted);
  }

  .day-cell.is-today::after {
    pointer-events: none;
    content: "";

    position: absolute;
    z-index: 3;
    inset: 0;

    box-shadow: inset 0 0 0 2px var(--interactive-accent);
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
    pointer-events: none;
    content: "";

    position: absolute;
    z-index: 4;
    inset: 0;

    box-shadow: inset 0 0 0 2px var(--interactive-accent);
  }
</style>
