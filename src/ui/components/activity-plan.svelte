<script lang="ts">
  import { getActivityDefinition } from "../../util/activity-definitions";

  type ActivityPlanItem = {
    name: string;
    defaultHours: number;
    maxHours?: number;
  };

  const defaultMaxHours = 40;
  const weeklyHours = 168;
  const activityPlanItems: ActivityPlanItem[] = [
    { name: "bed", defaultHours: 56, maxHours: 70 },
    { name: "deep work", defaultHours: 10 },
    { name: "light work", defaultHours: 30 },
    { name: "game", defaultHours: 15 },
    { name: "read", defaultHours: 5 },
    { name: "juggle", defaultHours: 3 },
    { name: "language", defaultHours: 3 },
    { name: "exercise", defaultHours: 2 },
    { name: "stretch", defaultHours: 2 },
    { name: "walk", defaultHours: 3 },
    { name: "housework", defaultHours: 5 },
    { name: "cook", defaultHours: 5 },
    { name: "hygiene", defaultHours: 2 },
  ];

  let hoursByActivity = $state<Record<string, number>>(
    Object.fromEntries(
      activityPlanItems.map(({ name, defaultHours }) => [name, defaultHours]),
    ),
  );

  let totalHours = $derived(
    activityPlanItems.reduce(
      (total, { name }) => total + (hoursByActivity[name] ?? 0),
      0,
    ),
  );
  let remainingHours = $derived(weeklyHours - totalHours);

  function getLabel(name: string) {
    return getActivityDefinition(name)?.label ?? name;
  }

  function getEmoji(name: string) {
    return getActivityDefinition(name)?.emoji;
  }

  function getMaxHours(item: ActivityPlanItem) {
    return item.maxHours ?? defaultMaxHours;
  }

  function getSliderFillPercent(hours: number, maxHours: number) {
    return Math.max(0, Math.min(100, (hours / maxHours) * 100));
  }

  function formatHours(hours: number) {
    return Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
  }

  function setActivityHours(name: string, value: string) {
    hoursByActivity = {
      ...hoursByActivity,
      [name]: Number(value),
    };
  }
</script>

<div class="activity-plan">
  <div class="activity-plan-header">
    <div>
      <h3>Activity Plan</h3>
      <div class="subtitle">Weekly allocation</div>
    </div>
    <div class="remaining" class:over={remainingHours < 0}>
      {formatHours(Math.abs(remainingHours))}h
      {remainingHours < 0 ? "over" : "left"}
    </div>
  </div>

  <div class="activity-summary">
    <div>
      <span class="summary-label">Planned</span>
      <span class="summary-value">{formatHours(totalHours)}h</span>
    </div>
    <div>
      <span class="summary-label">Per day</span>
      <span class="summary-value">{formatHours(totalHours / 7)}h</span>
    </div>
    <div>
      <span class="summary-label">Week</span>
      <span class="summary-value">{weeklyHours}h</span>
    </div>
  </div>

  <div class="activity-plan-list">
    {#each activityPlanItems as item (item.name)}
      {@const hours = hoursByActivity[item.name] ?? 0}
      {@const maxHours = getMaxHours(item)}
      {@const emoji = getEmoji(item.name)}
      <label class="activity-row">
        <div class="activity-row-top">
          <span class="activity-name">
            {#if emoji}
              <span class="activity-emoji" aria-hidden="true">{emoji}</span>
            {/if}
            <span>{getLabel(item.name)}</span>
          </span>
          <span class="activity-value">
            {formatHours(hours)}h
            <span class="per-day">/ {formatHours(hours / 7)}h day</span>
          </span>
        </div>
        <input
          style={`--slider-fill:${getSliderFillPercent(hours, maxHours)}%;`}
          max={maxHours}
          min="0"
          oninput={(event) =>
            setActivityHours(item.name, event.currentTarget.value)}
          step="1"
          type="range"
          value={hours}
        />
      </label>
    {/each}
  </div>
</div>

<style>
  .activity-plan {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);

    padding: var(--size-4-3);

    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }

  .activity-plan-header {
    display: flex;
    gap: var(--size-4-3);
    align-items: flex-start;
    justify-content: space-between;
  }

  .activity-plan-header h3 {
    margin: 0;
    font-size: var(--font-ui-large);
    font-weight: 750;
  }

  .subtitle,
  .summary-label,
  .per-day {
    color: var(--text-muted);
  }

  .subtitle {
    margin-top: 2px;
    font-size: var(--font-ui-smaller);
  }

  .remaining {
    flex: 0 0 auto;

    padding: var(--size-2-1) var(--size-4-2);

    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    color: var(--text-accent);

    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .remaining.over {
    color: var(--text-error);
  }

  .activity-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--size-4-2);
  }

  .activity-summary > div {
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding: var(--size-4-2);

    background: var(--background-secondary);
    border-radius: var(--radius-s);
  }

  .summary-label {
    font-size: var(--font-ui-smaller);
  }

  .summary-value {
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
  }

  .activity-plan-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  .activity-row {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
  }

  .activity-row-top {
    display: flex;
    gap: var(--size-4-2);
    align-items: baseline;
    justify-content: space-between;
  }

  .activity-name {
    overflow: hidden;
    display: inline-flex;
    gap: var(--size-2-2);
    align-items: center;

    font-weight: var(--font-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-emoji {
    flex: 0 0 auto;
    font-size: 1.1em;
    line-height: 1;
  }

  .activity-value {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  .per-day {
    font-size: var(--font-ui-smaller);
  }

  input[type="range"] {
    cursor: pointer;

    width: 100%;
    height: 18px;
    padding: 0;

    appearance: none;
    accent-color: var(--interactive-accent);
    background: linear-gradient(
      to right,
      var(--interactive-accent) 0%,
      var(--interactive-accent) var(--slider-fill),
      var(--background-modifier-border) var(--slider-fill),
      var(--background-modifier-border) 100%
    );
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 8px;
    border-radius: 999px;
    outline: none;
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 8px;
    background: transparent;
    border-radius: 999px;
  }

  input[type="range"]::-webkit-slider-thumb {
    width: 16px;
    height: 16px;

    appearance: none;
    background: var(--background-primary);
    border: 2px solid var(--interactive-accent);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--background-modifier-border);
  }

  input[type="range"]::-moz-range-track {
    height: 8px;
    background: transparent;
    border-radius: 999px;
  }

  input[type="range"]::-moz-range-progress {
    height: 8px;
    background: var(--interactive-accent);
    border-radius: 999px;
  }

  input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;

    background: var(--background-primary);
    border: 2px solid var(--interactive-accent);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--background-modifier-border);
  }

  @media (width <= 520px) {
    .activity-summary {
      grid-template-columns: 1fr;
    }

    .activity-row-top {
      flex-direction: column;
      gap: 2px;
      align-items: flex-start;
    }
  }
</style>
