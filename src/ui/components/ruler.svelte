<script lang="ts">
  import { getHourSize } from "../../global-store/derived-settings";
  import { settingsSignal } from "../../global-store/settings";
  import { hoursToMoment } from "../../util/moment";

  import CurrentTimeLabel from "./current-time-label.svelte";

  const {
    visibleHours,
    showCurrentTime = false,
  }: { visibleHours: number[]; showCurrentTime?: boolean } = $props();
</script>

<div class="hours-container">
  {#if showCurrentTime}
    <CurrentTimeLabel />
  {/if}
  {#each visibleHours as hour}
    <div
      style:flex-basis="{getHourSize(settingsSignal.current)}px"
      class="hour"
    >
      {hoursToMoment(hour).format(settingsSignal.current.hourFormat)}
    </div>
  {/each}
</div>

<style>
  .hours-container {
    position: sticky;
    z-index: 5;
    left: 0;

    display: flex;
    flex-direction: column;

    height: fit-content;

    background-color: var(--background-primary);
    border-right: 1px solid var(--background-modifier-border);
    box-shadow: var(--ruler-box-shadow, none);
  }

  .hour {
    display: flex;
    flex: 1 0 0;
    flex-direction: row-reverse;

    padding-inline: var(--size-4-2);

    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    color: var(--text-muted);

    border-bottom: 1px solid var(--background-modifier-border);
  }
</style>
