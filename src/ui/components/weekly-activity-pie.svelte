<script lang="ts">
  import {
    ArcElement,
    Chart as ChartJS,
    Tooltip,
    type ChartData,
    type ChartOptions,
  } from "chart.js";
  import ChartDataLabels from "chartjs-plugin-datalabels";
  import type { Duration } from "moment";
  import { Pie } from "svelte-chartjs";

  import type { ActivityDuration } from "../../util/activity-log-summary";
  import { buildWeeklyActivityPieSlices } from "../../util/activity-pie";
  import { formatDuration } from "../../util/duration";

  ChartJS.register(ArcElement, Tooltip);

  let {
    totals,
    unrecordedTime,
  }: { totals: ActivityDuration[]; unrecordedTime: Duration } = $props();

  const slices = $derived(buildWeeklyActivityPieSlices(totals, unrecordedTime));
  const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0));
  const data: ChartData<"pie", number[], string> = $derived({
    labels: slices.map((slice) => `${slice.emoji} ${slice.label}`),
    datasets: [
      {
        data: slices.map((slice) => slice.value),
        backgroundColor: slices.map((slice) => slice.color),
        borderColor: () =>
          getComputedStyle(document.body)
            .getPropertyValue("--background-primary")
            .trim() || "#ffffff",
        borderWidth: 2,
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

<figure class="weekly-activity-pie">
  <figcaption>
    <h3>Weekly activity time</h3>
    <p>{displayTime(total)} so far this week</p>
  </figcaption>
  {#if total > 0}
    <div class="chart-layout">
      <div class="pie-canvas">
        <Pie
          aria-label="Weekly activity time, including unrecorded time. Values are listed in the chart legend."
          {data}
          {options}
          plugins={[ChartDataLabels]}
          role="img"
          updateMode="none"
        />
      </div>
      <ul class="chart-legend" aria-label="Weekly activity time breakdown">
        {#each slices as slice (slice.key)}
          <li title={`${slice.label}: ${slice.durationLabel}`}>
            <span
              style:background-color={slice.color}
              class="color-swatch"
              aria-hidden="true"
            ></span>
            <span class="slice-name">{slice.emoji} {slice.label}</span>
            <span class="slice-value">
              {displayTime(slice.value)}
              <span class="slice-percentage">{percentage(slice.value)}</span>
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="empty-state">No elapsed time yet this week.</p>
  {/if}
</figure>

<style>
  .weekly-activity-pie {
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
    flex-wrap: wrap;
    gap: var(--size-4-4);
    align-items: center;
    justify-content: center;
  }

  .pie-canvas {
    position: relative;

    flex: 0 1 auto;

    aspect-ratio: 1;
    width: min(100%, 22rem);
    min-width: 0;
    max-width: 22rem;
  }

  .pie-canvas :global(canvas) {
    position: absolute;
    inset: 0;
  }

  .chart-legend {
    display: grid;
    flex: 1 1 15rem;
    gap: var(--size-2-3);

    min-width: 0;
    margin: 0;
    padding: 0;

    list-style: none;
  }

  .chart-legend li {
    display: grid;
    grid-template-columns: 0.65rem minmax(0, 1fr) auto;
    gap: var(--size-2-3);
    align-items: center;

    font-size: var(--font-ui-small);
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
</style>
