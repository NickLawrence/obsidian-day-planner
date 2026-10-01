<script lang="ts">
  import { setTooltip } from "obsidian";

  import type { ActivityDashboardWeek } from "../../util/activity-dashboard";
  import { formatDuration } from "../../util/duration";

  type WeeklyActivityHeatmapRow = {
    key: string;
    label: string;
    minutes: number;
    color?: string;
    weeks: ActivityDashboardWeek[];
  };

  let {
    weeks = [],
    label,
    square = false,
    color,
    rows,
  }: {
    weeks?: ActivityDashboardWeek[];
    label: string;
    square?: boolean;
    color?: string;
    rows?: WeeklyActivityHeatmapRow[];
  } = $props();

  const displayedWeeks = $derived(rows?.[0]?.weeks ?? weeks);
  const monthGroups = $derived(
    displayedWeeks.reduce<
      Array<{ month: string; start: number; count: number }>
    >((groups, week, index) => {
      const previous = groups.at(-1);
      if (previous?.month === week.month) previous.count += 1;
      else groups.push({ month: week.month, start: index + 1, count: 1 });
      return groups;
    }, []),
  );

  function displayTime(minutes: number) {
    return formatDuration(window.moment.duration(minutes, "minutes"));
  }

  function weeklyTooltip(node: HTMLElement, text: string) {
    // Use a nonzero delay to avoid falling back to Obsidian's default delay.
    setTooltip(node, text, { delay: 1 });
    return {
      update(text: string) {
        setTooltip(node, text, { delay: 1 });
      },
    };
  }
</script>

{#if rows}
  <div class="year-grid-wrap">
    <div class="year-grid">
      {#each monthGroups as group}
        <span
          style={`grid-column: ${group.start + 1} / span ${group.count}`}
          class="year-month">{group.month}</span
        >
      {/each}
      <span class="total-heading">Total</span>

      {#each rows as row, rowIndex (row.key)}
        <strong style={`grid-row: ${rowIndex + 2}`} class="row-label">
          {row.label}
        </strong>
        {#each row.weeks as week, weekIndex}
          <div
            style={`--week-intensity: ${week.intensity}; --activity-heatmap-color: ${row.color ?? "var(--interactive-accent)"}; grid-column: ${weekIndex + 2}; grid-row: ${rowIndex + 2}`}
            class="week-bar square-cell"
            class:empty={week.minutes === 0}
            aria-label={`${row.label}, ${week.start} through ${week.end}: ${displayTime(week.minutes)}`}
            use:weeklyTooltip={`${row.label} · ${week.start}–${week.end}: ${displayTime(week.minutes)}`}
          ></div>
        {/each}
        <span style={`grid-row: ${rowIndex + 2}`} class="row-total">
          {displayTime(row.minutes)}
        </span>
      {/each}
    </div>
  </div>
{:else}
  <div
    style:--activity-heatmap-color={color}
    class="activity-heatmap"
    class:square
  >
    <div class="month-labels" aria-hidden="true">
      {#each monthGroups as group}
        <span style={`grid-column: ${group.start} / span ${group.count}`}
          >{group.month}</span
        >
      {/each}
    </div>
    <div class="week-bars">
      {#each weeks as week}
        <div
          style={`--week-intensity: ${week.intensity}`}
          class="week-bar"
          class:empty={week.minutes === 0}
          aria-label={`${label}, ${week.start} through ${week.end}: ${displayTime(week.minutes)}`}
          use:weeklyTooltip={`${week.start}–${week.end}: ${displayTime(week.minutes)}`}
        ></div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .activity-heatmap {
    overflow-x: auto;
    padding: var(--size-2-2) 0 var(--size-4-2);
  }

  .year-grid-wrap {
    overflow-x: auto;
  }

  .year-grid {
    display: grid;
    grid-template-columns: max-content repeat(52, minmax(0.75rem, 1fr)) max-content;
    gap: 2px;
    align-items: center;

    width: 100%;
  }

  .year-month {
    overflow: hidden;

    padding-bottom: var(--size-2-2);

    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-align: center;
  }

  .total-heading {
    grid-column: 54;

    padding: 0 0 var(--size-2-2) var(--size-4-3);

    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-align: right;
  }

  .row-label {
    overflow: hidden;
    grid-column: 1;

    min-width: 8rem;
    max-width: 14rem;
    padding-right: var(--size-4-3);

    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-total {
    grid-column: 54;

    padding-left: var(--size-4-3);

    color: var(--text-muted);
    text-align: right;
    white-space: nowrap;
  }

  .row-label,
  .row-total {
    font-size: var(--font-ui-smaller);
    line-height: 1.2;
  }

  .year-grid .square-cell {
    aspect-ratio: 1;
    width: 100%;
    height: auto;
  }

  .month-labels,
  .week-bars {
    display: grid;
    grid-template-columns: repeat(52, minmax(4px, 1fr));
    gap: 2px;
    min-width: 31rem;
  }

  .month-labels {
    margin-bottom: var(--size-2-2);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .month-labels span {
    overflow: hidden;
    text-align: center;
  }

  .week-bar {
    cursor: default;

    height: 3rem;

    opacity: calc(0.18 + var(--week-intensity) * 0.82);
    background: var(--activity-heatmap-color, var(--interactive-accent));
    border-radius: 2px;
  }

  .square .week-bars {
    grid-template-columns: repeat(52, 0.75rem);
    min-width: max-content;
  }

  .square .month-labels {
    grid-template-columns: repeat(52, 0.75rem);
    min-width: max-content;
  }

  .square .week-bar {
    width: 0.75rem;
    height: 0.75rem;
  }

  .week-bar.empty {
    opacity: 0.08;
  }

  .week-bar:hover {
    outline: 1px solid var(--text-normal);
    outline-offset: 1px;
  }
</style>
