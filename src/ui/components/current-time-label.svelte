<script lang="ts">
  import { currentTimeSignal } from "../../global-store/current-time";
  import { timeToTimelineOffset } from "../../global-store/derived-settings";
  import { settingsSignal } from "../../global-store/settings";
  import { getMinutesSinceMidnight } from "../../util/moment";

  const offset = $derived(
    timeToTimelineOffset(
      getMinutesSinceMidnight(currentTimeSignal.current),
      settingsSignal.current,
    ),
  );
  const label = $derived(
    currentTimeSignal.current.format(settingsSignal.current.timestampFormat),
  );
</script>

{#if offset >= 0}
  <span class="label-width" aria-hidden="true">{label}</span>
  <span
    style:top="clamp(var(--label-half-height), {offset + 1}px, calc(100% -
    var(--label-half-height)))"
    class="current-time-label"
    aria-label="Current time: {label}"
  >
    {label}
  </span>
{/if}

<style>
  .label-width,
  .current-time-label {
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    white-space: nowrap;
  }

  .label-width {
    flex: 0 0 0;
    height: 0;
    padding-inline: var(--size-4-2);
    visibility: hidden;
  }

  .current-time-label {
    --label-half-height: calc(0.6em + 2px);

    pointer-events: none;

    position: absolute;
    z-index: 6;
    right: var(--size-2-1);
    left: var(--size-2-1);
    transform: translateY(-50%);

    padding: 1px 4px;

    color: var(--color-accent);
    text-align: center;

    background: var(--background-primary);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-s);
    box-shadow: 0 2px 5px rgb(0 0 0 / 35%);
  }

  :global(.theme-light) .current-time-label {
    box-shadow: 0 2px 5px rgb(0 0 0 / 20%);
  }
</style>
