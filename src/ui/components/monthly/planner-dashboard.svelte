<script lang="ts">
  import MonthlyCalendar from "./monthly-calendar.svelte";
  import YearlyDashboard from "./yearly-dashboard.svelte";

  type DashboardTab = "yearly" | "monthly";
  let activeTab: DashboardTab = $state("yearly");
</script>

<div class="planner-dashboard">
  <nav class="dashboard-tabs" aria-label="Planner dashboard views">
    <button
      class:active={activeTab === "yearly"}
      aria-selected={activeTab === "yearly"}
      onclick={() => (activeTab = "yearly")}
      role="tab"
      type="button">Yearly Dashboard</button
    >
    <button
      class:active={activeTab === "monthly"}
      aria-selected={activeTab === "monthly"}
      onclick={() => (activeTab = "monthly")}
      role="tab"
      type="button">Monthly Dashboard</button
    >
  </nav>

  <div class="dashboard-content" role="tabpanel">
    {#if activeTab === "yearly"}
      <YearlyDashboard />
    {:else}
      <MonthlyCalendar />
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
</style>
