<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { getObsidianContext } from "../../../context/obsidian-context";
  import { buildActivityDashboards } from "../../../util/activity-dashboard";
  import {
    getActivityDefinitions,
    getActivityGroup,
  } from "../../../util/activity-definitions";
  import { applyActivityColorVariant } from "../../../util/color";
  import ActivityPie from "../activity-pie.svelte";
  import WeeklyActivityHeatmap from "../weekly-activity-heatmap.svelte";

  const { plannerData, getAllActivities } = getObsidianContext();
  const definitions = getActivityDefinitions();
  let activities = $state.raw(getAllActivities());
  let now = $state(window.moment());
  let goalActivities = $state<string[]>([]);
  let goalWeek: string | undefined;
  let goalRequest = 0;
  const year = $derived(now.year());
  const yearStart = $derived(window.moment({ year }).startOf("year"));
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let stopPlannerListener: (() => void) | undefined;

  const activityRows = $derived.by(() => {
    const dashboards = buildActivityDashboards(activities, definitions, year, {
      includeHistory: false,
    });
    return definitions
      .map((definition) => {
        const dashboard = dashboards.get(definition.name)!;
        return {
          definition,
          weeks: dashboard.weeks,
          color: applyActivityColorVariant(
            getActivityGroup(definition.name)?.color ?? "#808080",
            definition.color,
          ),
          totalMinutes: dashboard.weeks.reduce(
            (total, week) => total + (week.totalMinutes ?? week.minutes),
            0,
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
      );
  });

  function refresh(forceGoals = false) {
    now = window.moment();
    activities = getAllActivities();
    void refreshGoals(forceGoals);
  }

  async function refreshGoals(force = false) {
    const weekStart = window.moment().startOf("isoWeek");
    const weekKey = weekStart.format("YYYY-MM-DD");
    if (!force && goalWeek === weekKey) return;
    if (goalWeek !== weekKey) goalActivities = [];
    goalWeek = weekKey;
    const request = ++goalRequest;
    try {
      const entries = await plannerData.readPlanEntries(weekStart);
      if (request !== goalRequest) return;
      goalActivities = entries
        .filter((entry) => entry.kind === "goal")
        .map((entry) => entry.activity);
    } catch (error) {
      if (request !== goalRequest) return;
      goalWeek = undefined;
      goalActivities = [];
      console.error("Failed to load weekly goals for the activity pie", error);
    }
  }

  onMount(() => {
    void refreshGoals();
    refreshTimer = setInterval(refresh, 60_000);
    stopPlannerListener = plannerData.onChange(() => refresh(true));
  });

  onDestroy(() => {
    goalRequest++;
    if (refreshTimer) clearInterval(refreshTimer);
    stopPlannerListener?.();
  });
</script>

<section class="yearly-dashboard" aria-labelledby="yearly-dashboard-heading">
  <header>
    <div>
      <h2 id="yearly-dashboard-heading">{now.year()} Activity</h2>
      <p>Weekly activity totals for the year</p>
    </div>
  </header>

  <div class="activity-grid">
    <WeeklyActivityHeatmap
      label={`${now.year()} activity by week`}
      rows={activityRows.map((row) => ({
        key: row.definition.name,
        label: row.definition.emoji
          ? `${row.definition.emoji} ${row.definition.label}`
          : row.definition.label,
        minutes: row.minutes,
        totalMinutes: row.totalMinutes,
        color: row.color,
        weeks: row.weeks,
      }))}
    />
    <ActivityPie
      {activities}
      {goalActivities}
      periodLabel={`so far in ${now.year()}`}
      rangeEnd={now}
      rangeStart={yearStart}
      title="Yearly activity time"
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
    display: flex;
    flex-direction: column;
    gap: var(--size-4-4);

    padding: var(--size-4-3);

    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }
</style>
