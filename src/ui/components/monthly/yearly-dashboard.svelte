<script lang="ts">
  import type { EventRef } from "obsidian";
  import { onDestroy, onMount } from "svelte";

  import { getObsidianContext } from "../../../context/obsidian-context";
  import { buildActivityDashboard } from "../../../util/activity-dashboard";
  import {
    getActivityDefinitions,
    getActivityGroup,
  } from "../../../util/activity-definitions";
  import { applyActivityColorVariant } from "../../../util/color";
  import WeeklyActivityHeatmap from "../weekly-activity-heatmap.svelte";

  const { app, getAllActivities } = getObsidianContext();
  const definitions = getActivityDefinitions();
  let activities = $state(getAllActivities());
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let metadataChangeRef: EventRef | undefined;

  const activityRows = $derived(
    definitions
      .map((definition) => {
        const dashboard = buildActivityDashboard(activities, definition);
        return {
          definition,
          weeks: dashboard.weeks,
          color: applyActivityColorVariant(
            getActivityGroup(definition.name)?.color ?? "#808080",
            definition.color,
          ),
          minutes: dashboard.weeks.reduce(
            (total, week) => total + week.minutes,
            0,
          ),
        };
      })
      .sort(
        (left, right) =>
          right.minutes - left.minutes ||
          left.definition.label.localeCompare(right.definition.label),
      ),
  );

  function refresh() {
    activities = getAllActivities();
  }

  onMount(() => {
    refreshTimer = setInterval(refresh, 2_000);
    metadataChangeRef = app.metadataCache.on("changed", refresh);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (metadataChangeRef) app.metadataCache.offref(metadataChangeRef);
  });
</script>

<section class="yearly-dashboard" aria-labelledby="yearly-dashboard-heading">
  <header>
    <div>
      <h2 id="yearly-dashboard-heading">{window.moment().year()} Activity</h2>
      <p>Weekly activity totals for the year</p>
    </div>
  </header>

  <div class="activity-grid">
    <WeeklyActivityHeatmap
      label={`${window.moment().year()} activity by week`}
      rows={activityRows.map((row) => ({
        key: row.definition.name,
        label: row.definition.emoji
          ? `${row.definition.emoji} ${row.definition.label}`
          : row.definition.label,
        minutes: row.minutes,
        color: row.color,
        weeks: row.weeks,
      }))}
    />
  </div>
</section>

<style>
  .yearly-dashboard {
    padding: var(--size-4-4);
  }

  header h2 {
    margin: 0;
  }

  header p {
    margin: var(--size-2-2) 0 var(--size-4-4);
    color: var(--text-muted);
  }

  .activity-grid {
    padding: var(--size-4-3);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }
</style>
