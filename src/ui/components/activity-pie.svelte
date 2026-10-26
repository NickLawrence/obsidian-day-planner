<script lang="ts">
  import {
    ArcElement,
    Chart as ChartJS,
    Tooltip,
    type ChartData,
    type ChartOptions,
  } from "chart.js";
  import ChartDataLabels from "chartjs-plugin-datalabels";
  import type { Moment } from "moment";
  import { onMount } from "svelte";
  import { Pie } from "svelte-chartjs";

  import { normalizeActivityName } from "../../util/activity-definitions";
  import {
    calculateActivityPieForRange,
    groupActivityPieSlices,
  } from "../../util/activity-pie";
  import { formatDuration } from "../../util/duration";
  import type { Activity } from "../../util/props";

  ChartJS.register(ArcElement, Tooltip);

  let {
    activities,
    rangeStart,
    rangeEnd,
    title = "Activity time",
    periodLabel = "in this period",
    goalActivities = [],
  }: {
    activities: Activity[];
    rangeStart: Moment;
    rangeEnd: Moment;
    title?: string;
    periodLabel?: string;
    goalActivities?: string[];
  } = $props();

  let chart = $state.raw<ChartJS<"pie", unknown, unknown> | null>(null);
  const goalKeys = $derived(new Set(goalActivities.map(normalizeActivityName)));
  const slices = $derived(
    calculateActivityPieForRange(activities, rangeStart, rangeEnd),
  );
  const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0));
  const groups = $derived(groupActivityPieSlices(slices));
  const data: ChartData<"pie", number[], string> = $derived({
    labels: slices.map((slice) => `${slice.emoji} ${slice.label}`),
    datasets: [
      {
        data: slices.map((slice) => slice.value),
        backgroundColor: slices.map((slice) => slice.color),
        borderColor: ({ dataIndex }) =>
          isGoal(slices[dataIndex]?.key)
            ? themeColor("--interactive-accent", "#7856c8")
            : themeColor("--background-primary", "#ffffff"),
        borderWidth: slices.map((slice) => (isGoal(slice.key) ? 4 : 2)),
        borderAlign: "inner",
        hoverOffset: 6,
      },
    ],
  });
  const options: ChartOptions<"pie"> = $derived({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: 8 },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ({ dataIndex }) => {
            const slice = slices[dataIndex];
            return `${slice.label}: ${slice.durationLabel} · ${percentage(slice.value)}`;
          },
        },
      },
      datalabels: {
        formatter: (_, { dataIndex }) => slices[dataIndex]?.emoji ?? "",
        anchor: "end",
        align: "start",
        offset: ({ chart, dataIndex }) => {
          const arc = chart.getDatasetMeta(0).data[dataIndex];
          return arc instanceof ArcElement ? arc.outerRadius * 0.2 : 0;
        },
        clamp: true,
        padding: 0,
        color: "#ffffff",
        // Very small wedges cannot contain a legible emoji. Keep them in the
        // legend and tooltip instead of drawing labels across neighboring slices.
        display: ({ chart, dataIndex }) =>
          labelWidth(chart, dataIndex) >= 14 ? "auto" : false,
        font: ({ chart, dataIndex }) => ({
          family:
            "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
          size: Math.min(22, Math.max(10, labelWidth(chart, dataIndex) - 4)),
          lineHeight: 1,
        }),
      },
    },
  });

  onMount(() => {
    // Canvas colors need a redraw when Obsidian changes its theme or accent.
    const observer = new MutationObserver(() => chart?.update("none"));
    for (const element of [document.body, document.documentElement]) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    return () => observer.disconnect();
  });

  function isGoal(key: string | undefined) {
    return key !== undefined && key !== "__unrecorded__" && goalKeys.has(key);
  }

  function themeColor(variable: string, fallback: string) {
    return (
      getComputedStyle(document.body).getPropertyValue(variable).trim() ||
      fallback
    );
  }

  function labelWidth(chart: ChartJS, dataIndex: number) {
    const arc = chart.getDatasetMeta(0).data[dataIndex];
    return arc instanceof ArcElement
      ? 1.3 *
          arc.outerRadius *
          Math.sin(Math.min(arc.circumference, Math.PI) / 2)
      : 0;
  }

  function displayTime(value: number) {
    return formatDuration(window.moment.duration(value));
  }

  function percentage(value: number) {
    return `${((value / total) * 100).toFixed(1)}%`;
  }
</script>

<figure class="activity-pie">
  <figcaption>
    <h3>{title}</h3>
    <p>{displayTime(total)} {periodLabel}</p>
  </figcaption>
  {#if total > 0}
    <div class="chart-layout">
      <div class="pie-canvas">
        <Pie
          aria-label={`${title}, including unrecorded time. Values are listed in the chart legend.`}
          {data}
          {options}
          plugins={[ChartDataLabels]}
          role="img"
          updateMode="none"
          bind:chart
        />
      </div>
      <ul class="chart-legend" aria-label={`${title} breakdown`}>
        {#each groups as group (group.key)}
          <li class="legend-group">
            <div class="group-heading">
              <span
                style:background-color={group.color}
                class="color-swatch"
                aria-hidden="true"
              ></span>
              <strong class="slice-name">{group.label}</strong>
              <span class="slice-value">
                {displayTime(group.value)}
                <span class="slice-percentage">{percentage(group.value)}</span>
              </span>
            </div>
            {#if group.key !== "__unrecorded__"}
              <ul class="group-activities" aria-label={group.label}>
                {#each group.slices as slice (slice.key)}
                  <li
                    class="legend-activity"
                    class:goal-match={isGoal(slice.key)}
                    title={`${slice.label}: ${slice.durationLabel}`}
                  >
                    <span
                      style:background-color={slice.color}
                      class="color-swatch"
                      aria-hidden="true"
                    ></span>
                    <span class="slice-name">{slice.emoji} {slice.label}</span>
                    <span class="slice-value">
                      {slice.durationLabel}
                      <span class="slice-percentage">
                        {percentage(slice.value)}
                      </span>
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="empty-state">No elapsed time in this period.</p>
  {/if}
</figure>

<style>
  .activity-pie {
    container-type: inline-size;
    margin: 0;
    padding-top: var(--size-4-3);
    border-top: 1px solid var(--background-modifier-border);
  }

  h3 {
    margin: 0;
    font-size: var(--font-ui-medium);
  }

  figcaption p,
  .empty-state {
    margin: var(--size-2-2) 0;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .chart-layout {
    display: flex;
    gap: var(--size-4-4);
    align-items: center;
    justify-content: center;
  }

  .pie-canvas {
    position: relative;

    flex: 1 1 0;

    aspect-ratio: 1;
    width: 100%;
    min-width: 0;
    max-width: 52rem;
  }

  .pie-canvas :global(canvas) {
    position: absolute;
    inset: 0;
  }

  .chart-legend {
    display: grid;
    flex: 0 1 auto;
    gap: var(--size-4-3);

    width: max-content;
    min-width: 0;
    max-width: 40%;
    margin: 0;
    padding: 0;

    list-style: none;
  }

  .legend-group {
    padding-bottom: var(--size-2-3);
    font-size: var(--font-ui-small);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .legend-group:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .group-heading,
  .legend-activity {
    display: grid;
    grid-template-columns: 0.65rem minmax(0, 1fr) auto;
    gap: var(--size-2-3);
    align-items: center;
  }

  .group-activities {
    display: grid;
    gap: var(--size-2-3);

    margin: var(--size-2-3) 0 0;
    padding: 0 0 0 var(--size-4-3);

    list-style: none;
  }

  .legend-activity.goal-match {
    padding: 2px 6px;
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

  .color-swatch {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
  }

  .slice-name {
    overflow-wrap: anywhere;
  }

  .slice-value {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  .slice-percentage {
    margin-left: var(--size-2-2);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  @container (width < 40rem) {
    .chart-layout {
      flex-direction: column;
    }

    .pie-canvas {
      flex: none;
      max-width: 36rem;
    }

    .chart-legend {
      max-width: 100%;
    }
  }
</style>
