<script lang="ts">
  import type { App, EventRef } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import type { PlannerData } from "../../service/planner-data";
  import {
    buildActivityDashboard,
    type ActivityDashboardRow,
  } from "../../util/activity-dashboard";
  import type { ActivityDefinition } from "../../util/activity-definitions";
  import { getActivityDashboardEntries } from "../../util/activity-progress";
  import type { DayPlannerActivityApi } from "../../util/activity-totals";
  import { formatActivityDuration } from "../../util/duration";

  import WeeklyActivityHeatmap from "./weekly-activity-heatmap.svelte";

  let {
    app,
    activityApi,
    plannerData,
  }: {
    app: App;
    activityApi: DayPlannerActivityApi;
    plannerData: PlannerData;
  } = $props();

  const definitions = activityApi.getActivityDefinitions();
  let selectedName = $state(definitions[0]?.name ?? "");
  let activities = $state.raw(activityApi.getAllActivities());
  let progressTime = $state(window.moment());
  const year = $derived(progressTime.year());
  let metadataChangeRef: EventRef | undefined;
  let resourceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let stopPlannerListener: (() => void) | undefined;

  const definition = $derived(
    definitions.find(({ name }) => name === selectedName),
  );
  const dashboard = $derived(
    definition
      ? buildActivityDashboard(activities, definition, year)
      : { rows: [], groups: [], weeks: [] },
  );
  const entries = $derived(
    definition
      ? getActivityDashboardEntries(
          app,
          activities,
          definition,
          dashboard.groups,
          progressTime,
        )
      : [],
  );

  function refresh() {
    activities = activityApi.getAllActivities();
    progressTime = window.moment();
  }

  function displayTime(minutes: number, totalMinutes?: number) {
    return formatActivityDuration({
      duration: window.moment.duration(minutes, "minutes"),
      totalDuration:
        totalMinutes === undefined
          ? undefined
          : window.moment.duration(totalMinutes, "minutes"),
    });
  }

  function selectActivity(activity: ActivityDefinition) {
    selectedName = activity.name;
  }

  onMount(() => {
    const firstWithLogs = definitions.find((candidate) =>
      activities.some(
        ({ activity, log }) =>
          activity.trim().toLowerCase() === candidate.name.toLowerCase() &&
          log?.some(({ end }) => end),
      ),
    );
    if (firstWithLogs) selectedName = firstWithLogs.name;

    refreshTimer = setInterval(refresh, 60_000);
    stopPlannerListener = plannerData.onChange(refresh);
    metadataChangeRef = app.metadataCache.on("changed", () => {
      if (resourceRefreshTimer) clearTimeout(resourceRefreshTimer);
      resourceRefreshTimer = setTimeout(() => {
        resourceRefreshTimer = undefined;
        progressTime = window.moment();
      }, 250);
    });
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    stopPlannerListener?.();
    if (resourceRefreshTimer) clearTimeout(resourceRefreshTimer);
    if (metadataChangeRef) app.metadataCache.offref(metadataChangeRef);
  });
</script>

{#snippet logTable(rows: ActivityDashboardRow[])}
  {#if definition}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Day / Start</th><th>Time</th><th>Notes</th><th>Quality</th>
            {#each definition.attributes?.start ?? [] as field}<th
                >{field.label}</th
              >{/each}
            {#each definition.attributes?.end ?? [] as field}<th
                >{field.label}</th
              >{/each}
            {#each definition.attributes?.ranges ?? [] as range}<th
                >{range.key}</th
              >{/each}
            {#each definition.attributes?.ranges ?? [] as range}<th
                >{range.key} per Hour</th
              >{/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row}
            <tr>
              <td
                ><time datetime={window.moment(row.start).toISOString()}
                  >{row.day} {window.moment(row.start).format("HH:mm")}</time
                ></td
              >
              <td>{displayTime(row.minutes, row.totalMinutes)}</td><td
                >{row.notes}</td
              ><td>{row.quality}</td>
              {#each row.startValues as value}<td>{String(value)}</td>{/each}
              {#each row.endValues as value}<td>{String(value)}</td>{/each}
              {#each row.rangeValues as value}<td>{value}</td>{/each}
              {#each row.rangeValuesPerHour as value}<td
                  >{typeof value === "number" ? value.toFixed(1) : value}</td
                >{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/snippet}

<div class="activity-dashboard">
  <nav class="activity-toggle" aria-label="Select activity">
    {#each definitions as activity (activity.name)}
      <button
        class:active={activity.name === selectedName}
        aria-pressed={activity.name === selectedName}
        onclick={() => selectActivity(activity)}
        type="button"
      >
        {#if activity.emoji}<span aria-hidden="true">{activity.emoji}</span
          >{/if}
        <span>{activity.label}</span>
      </button>
    {/each}
  </nav>

  {#if definition}
    <WeeklyActivityHeatmap
      allowDaily
      label={definition.label}
      weeks={dashboard.weeks}
    />

    <section>
      <h3>
        {definition.emoji ?? ""}
        {definition.label} — {definition.attributes?.mainKey
          ? "Activity"
          : "Activity Logs"}
      </h3>
      {#if definition.attributes?.mainKey}
        {#if entries.length === 0}
          <p class="empty">No {definition.label} activity found.</p>
        {:else}
          <div class="progress-list">
            {#each entries as item (item.value)}
              <article class="activity-entry">
                <div class="entry-overview">
                  {#if item.cover}
                    <img
                      class="cover"
                      alt={`Cover for ${item.value}`}
                      loading="lazy"
                      src={item.cover}
                    />
                  {/if}
                  <div class="entry-info">
                    <div class="progress-heading">
                      <strong>
                        {#if item.filePath}
                          <a
                            class="internal-link"
                            href={item.filePath}
                            onclick={(event) => {
                              event.preventDefault();
                              void app.workspace.openLinkText(
                                item.filePath!,
                                "",
                                event.ctrlKey || event.metaKey,
                              );
                            }}>{item.value}</a
                          >
                        {:else}
                          {item.value}
                        {/if}
                      </strong>
                      {#if item.inProgress}<span class="status"
                          >In Progress</span
                        >{/if}
                      {#if item.percent !== undefined}<span
                          >{item.percent.toFixed(0)}%</span
                        >{/if}
                    </div>
                    <div class="progress-details">
                      <span
                        >{displayTime(
                          item.countedMinutes ?? item.minutes,
                          item.minutes,
                        )} spent</span
                      >
                      <span>Earliest: {item.earliest ?? "—"}</span>
                      <span>Most recent: {item.latest ?? "—"}</span>
                    </div>
                    {#if item.percent !== undefined}
                      <progress
                        aria-label={`${item.value} progress`}
                        max="100"
                        value={item.percent}
                        >{item.percent.toFixed(0)}%</progress
                      >
                      <div class="progress-details">
                        <span
                          >{item.current} / {item.maximum} {item.rangeKey}</span
                        >
                        {#if item.minutesPerUnit !== undefined}
                          <span
                            >{item.minutesPerUnit.toFixed(1)} min/{item.rangeKey?.replace(
                              /s$/,
                              "",
                            )}</span
                          >
                        {/if}
                        {#if item.estimatedMinutesRemaining !== undefined}
                          <span
                            >About {displayTime(item.estimatedMinutesRemaining)}
                            remaining</span
                          >
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
                <details>
                  <summary>Activity logs ({item.rows.length})</summary>
                  {#if item.rows.length}
                    {@render logTable(item.rows)}
                  {:else}
                    <p class="empty">No closed activity logs yet.</p>
                  {/if}
                </details>
              </article>
            {/each}
          </div>
        {/if}
      {:else if dashboard.rows.length === 0}
        <p class="empty">No closed {definition.label} activity logs found.</p>
      {:else}
        {@render logTable(dashboard.rows)}
      {/if}
    </section>
  {/if}
</div>

<style>
  .activity-dashboard {
    padding: var(--size-4-3);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }

  .activity-toggle {
    overflow-x: auto;
    display: flex;
    gap: var(--size-2-2);
    padding-bottom: var(--size-4-2);
  }

  .activity-toggle button {
    display: inline-flex;
    flex: 0 0 auto;
    gap: var(--size-2-2);
    align-items: center;

    padding: var(--size-2-2) var(--size-4-2);

    color: var(--text-muted);

    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    box-shadow: none;
  }

  .activity-toggle button:hover {
    color: var(--text-normal);
    border-color: var(--interactive-accent);
  }

  .activity-toggle button.active {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
  }

  .progress-list {
    display: grid;
    gap: var(--size-4-2);
  }

  .progress-list article {
    padding: var(--size-4-2);
    background: var(--background-secondary);
    border-radius: var(--radius-s);
  }

  .progress-heading,
  .progress-details {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-2) var(--size-4-3);
    justify-content: space-between;
  }

  .progress-list progress {
    width: 100%;
    margin: var(--size-2-2) 0;
    accent-color: var(--interactive-accent);
  }

  .progress-details {
    justify-content: flex-start;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  h3 {
    margin: var(--size-4-3) 0 var(--size-4-2);
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--font-ui-small);
  }

  th {
    color: var(--text-muted);
    text-align: left;
    white-space: nowrap;
  }

  th,
  td {
    padding: var(--size-2-3) var(--size-4-2);
    vertical-align: top;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  tbody tr:hover {
    background: var(--background-secondary-alt);
  }

  .entry-overview {
    display: flex;
    gap: var(--size-4-3);
    align-items: flex-start;
  }

  .entry-info {
    flex: 1;
    min-width: 0;
  }

  .cover {
    flex: 0 0 auto;

    width: 4rem;
    max-height: 6rem;

    object-fit: contain;
    border-radius: var(--radius-s);
  }

  .status {
    font-size: var(--font-ui-smaller);
    color: var(--text-accent);
  }

  details {
    margin-top: var(--size-4-2);
  }

  summary {
    cursor: pointer;
    width: fit-content;
    padding: var(--size-2-2) 0;
    color: var(--text-muted);
  }

  .empty {
    color: var(--text-muted);
  }
</style>
