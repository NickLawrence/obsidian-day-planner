<script lang="ts">
  import { getObsidianContext } from "../../context/obsidian-context";
  import type { LocalTask } from "../../task-types";
  import { formatDuration } from "../../util/duration";
  import type { Activity } from "../../util/props";
  import { createTimeBlockMenu } from "../time-block-menu";

  import LocalTimeBlock from "./local-time-block.svelte";
  import Selectable from "./selectable.svelte";

  const { task }: { task: LocalTask & { clockActivity?: Activity } } = $props();

  const { workspaceFacade, sTaskEditor } = getObsidianContext();

  function openActivityContextMenu(
    event: MouseEvent | PointerEvent | TouchEvent,
  ) {
    if (!task.clockActivity) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    createTimeBlockMenu({ event, task, workspaceFacade, sTaskEditor });
  }
</script>

<Selectable onSecondarySelect={openActivityContextMenu}>
  {#snippet children({ use, onpointerup, state })}
    <LocalTimeBlock
      isActive={state === "secondary"}
      {onpointerup}
      showDuration={false}
      {task}
      {use}
    >
      {#snippet bottomDecoration()}
        {#if task.clockActivity?.log?.[0]?.end}
          <span class="activity-duration">
            {formatDuration(
              window.moment.duration(task.durationMinutes, "minutes"),
            )}
          </span>
        {/if}
      {/snippet}
    </LocalTimeBlock>
  {/snippet}
</Selectable>

<style>
  .activity-duration {
    position: absolute;
    bottom: -1px;
    left: -1px;

    padding: 0 4px;

    font-size: var(--font-ui-smaller);
    line-height: 1.2;
    color: var(--text-faint);

    border-top: 1px solid color-mix(in srgb, var(--text-faint) 50%, transparent);
    border-right: 1px solid
      color-mix(in srgb, var(--text-faint) 50%, transparent);
    border-top-right-radius: var(--radius-s);
  }
</style>
