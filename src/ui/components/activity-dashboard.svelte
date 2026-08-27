<script lang="ts">
  import type { App, EventRef } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import { buildActivityDashboard } from "../../util/activity-dashboard";
  import type { ActivityDefinition } from "../../util/activity-definitions";
  import type { DayPlannerActivityApi } from "../../util/activity-totals";
  import { formatDuration } from "../../util/duration";

  let { app, activityApi }: { app: App; activityApi: DayPlannerActivityApi } =
    $props();

  const definitions = activityApi.getActivityDefinitions();
  let selectedName = $state(definitions[0]?.name ?? "");
  let activities = $state(activityApi.getAllActivities());
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let metadataChangeRef: EventRef | undefined;

  const definition = $derived(
    definitions.find(({ name }) => name === selectedName),
  );
  const dashboard = $derived(
    definition
      ? buildActivityDashboard(activities, definition)
      : { rows: [], groups: [] },
  );

  function refresh() {
    activities = activityApi.getAllActivities();
  }

  function displayTime(minutes: number) {
    return formatDuration(window.moment.duration(minutes, "minutes"));
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

    refreshTimer = setInterval(refresh, 2_000);
    metadataChangeRef = app.metadataCache.on("changed", refresh);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (metadataChangeRef) app.metadataCache.offref(metadataChangeRef);
  });
</script>

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
    <section>
      <h3>{definition.emoji ?? ""} {definition.label} — Activity Logs</h3>
      {#if dashboard.rows.length === 0}
        <p class="empty">No closed {definition.label} activity logs found.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead
              ><tr>
                <th>Day</th><th>Time</th><th>Notes</th><th>Quality</th>
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
              </tr></thead
            >
            <tbody>
              {#each dashboard.rows as row}
                <tr>
                  <td>{row.day}</td><td>{displayTime(row.minutes)}</td><td
                    >{row.notes}</td
                  ><td>{row.quality}</td>
                  {#each row.startValues as value}<td>{String(value)}</td
                    >{/each}
                  {#each row.endValues as value}<td>{String(value)}</td>{/each}
                  {#each row.rangeValues as value}<td>{value}</td>{/each}
                  {#each row.rangeValuesPerHour as value}<td
                      >{typeof value === "number"
                        ? value.toFixed(1)
                        : value}</td
                    >{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if definition.attributes?.mainKey}
          <h3>By {definition.attributes.mainKey} — Total Time</h3>
          <div class="table-wrap compact">
            <table>
              <thead
                ><tr
                  ><th>{definition.attributes.mainKey}</th><th>Total</th><th
                    >Earliest</th
                  ><th>Most Recent</th></tr
                ></thead
              >
              <tbody
                >{#each dashboard.groups as group}<tr
                    ><td>{group.value}</td><td>{displayTime(group.minutes)}</td
                    ><td>{group.earliest}</td><td>{group.latest}</td></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        {/if}
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

  .compact table {
    width: auto;
    min-width: 32rem;
  }

  .empty {
    color: var(--text-muted);
  }
</style>
