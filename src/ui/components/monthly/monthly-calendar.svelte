<script lang="ts">
  import { getActivityDefinitions } from "../../../util/activity-definitions";

  import Calendar from "./calendar.svelte";

  const activities = getActivityDefinitions();
  let selectedActivities = new Set<string>();

  $: allSelected = selectedActivities.size === 0;
  $: displayedActivities = allSelected ? undefined : [...selectedActivities];

  function showAll() {
    selectedActivities = new Set();
  }

  function toggleActivity(activityName: string) {
    const next = new Set(selectedActivities);
    if (next.has(activityName)) next.delete(activityName);
    else next.add(activityName);
    selectedActivities = next;
  }
</script>

<div class="monthly-calendar-view">
  <div class="activity-filters" aria-label="Activities displayed on calendar">
    <button
      class:selected={allSelected}
      aria-pressed={allSelected}
      on:click={showAll}
    >
      All
    </button>
    {#each activities as activity (activity.name)}
      <button
        class:selected={selectedActivities.has(activity.name)}
        aria-pressed={selectedActivities.has(activity.name)}
        on:click={() => toggleActivity(activity.name)}
      >
        {activity.emoji
          ? `${activity.emoji} ${activity.label}`
          : activity.label}
      </button>
    {/each}
  </div>

  <div class="calendar-container">
    <Calendar {displayedActivities} showWeeklyGoals={true} />
  </div>
</div>

<style>
  .monthly-calendar-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .activity-filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-2);
    padding: var(--size-4-3) var(--size-4-4) 0;
  }

  .activity-filters button {
    cursor: pointer;

    padding: var(--size-4-1) var(--size-4-2);

    color: var(--text-muted);

    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .activity-filters button:hover {
    background: var(--background-secondary);
  }

  .activity-filters button.selected {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
  }

  .calendar-container {
    flex: 1;
    min-height: 0;
  }
</style>
