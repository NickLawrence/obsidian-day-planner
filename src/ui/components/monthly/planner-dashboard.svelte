<script lang="ts">
  import { getObsidianContext } from "../../../context/obsidian-context";
  import { selectListProps } from "../../../redux/dataview/dataview-slice";
  import { createDayPlannerActivityApi } from "../../../util/activity-totals";
  import ActivityDashboard from "../activity-dashboard.svelte";
  import ActivityGoals from "../activity-goals.svelte";
  import ActivityPlan from "../activity-plan.svelte";

  import MonthlyCalendar from "./monthly-calendar.svelte";
  import YearlyDashboard from "./yearly-dashboard.svelte";

  const { app, plannerData, useSelector } = getObsidianContext();
  const activityApi = createDayPlannerActivityApi(useSelector(selectListProps));
  const tabs = [
    { key: "yearly", label: "Yearly Dashboard" },
    { key: "monthly", label: "Monthly Dashboard" },
    { key: "weekly", label: "Weekly Goals & Plan" },
    { key: "activity", label: "Activity Dashboard" },
  ] as const;
  type DashboardTab = (typeof tabs)[number]["key"];
  let activeTab: DashboardTab = $state("yearly");
</script>

<div class="planner-dashboard">
  <nav class="dashboard-tabs" aria-label="Planner dashboard views">
    {#each tabs as tab (tab.key)}
      <button
        class:active={activeTab === tab.key}
        aria-selected={activeTab === tab.key}
        onclick={() => (activeTab = tab.key)}
        role="tab"
        type="button">{tab.label}</button
      >
    {/each}
  </nav>

  <div class="dashboard-content" role="tabpanel">
    {#if activeTab === "yearly"}
      <YearlyDashboard />
    {:else if activeTab === "monthly"}
      <MonthlyCalendar />
    {:else if activeTab === "weekly"}
      <div class="embedded-dashboard">
        <ActivityGoals {activityApi} {app} {plannerData} />
        <ActivityPlan {plannerData} />
      </div>
    {:else}
      <div class="embedded-dashboard">
        <ActivityDashboard {activityApi} {app} {plannerData} />
      </div>
    {/if}
  </div>
</div>

<style>
  .planner-dashboard {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .dashboard-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-1);

    padding: var(--size-4-3) var(--size-4-4) 0;

    border-bottom: 1px solid var(--background-modifier-border);
  }

  .dashboard-tabs button {
    cursor: pointer;

    margin-bottom: -1px;
    padding: var(--size-4-2) var(--size-4-3);

    color: var(--text-muted);

    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: var(--radius-s) var(--radius-s) 0 0;
    box-shadow: none;
  }

  .dashboard-tabs button:hover {
    color: var(--text-normal);
    background: var(--background-secondary);
  }

  .dashboard-tabs button.active {
    color: var(--text-normal);
    border-bottom-color: var(--interactive-accent);
  }

  .dashboard-content {
    overflow: auto;
    flex: 1;
    min-height: 0;
  }

  .dashboard-content :global(.monthly-calendar-view) {
    min-height: 100%;
  }

  .embedded-dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-6);
    padding: var(--size-4-4);
  }
</style>
