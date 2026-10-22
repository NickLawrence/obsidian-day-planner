<script lang="ts">
  import type { Snippet } from "svelte";

  const { children }: { children: Snippet } = $props();
</script>

<span class="activity-duration">{@render children()}</span>

<style>
  .activity-duration {
    position: absolute;
    z-index: 1;
    bottom: -1px;
    left: -1px;

    padding: 0 4px;

    font-size: var(--font-ui-smaller);
    line-height: 1.2;
    color: var(--text-faint);

    background: transparent;
    border: 1px solid var(--time-block-border-color, var(--color-base-50));
    border-radius: 0;
    border-top-right-radius: inherit;
    border-bottom-left-radius: inherit;
  }
</style>
