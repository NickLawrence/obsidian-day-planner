<script lang="ts">
  import { getObsidianContext } from "../../context/obsidian-context";
  import type { LocalTask } from "../../task-types";
  import { formatDuration } from "../../util/duration";
  import type { Activity } from "../../util/props";
  import { createTimeBlockMenu } from "../time-block-menu";

  import LocalTimeBlock from "./local-time-block.svelte";

  const { task }: { task: LocalTask & { clockActivity?: Activity } } = $props();

  const { workspaceFacade, sTaskEditor } = getObsidianContext();

  function openActivityContextMenu(event: MouseEvent) {
    if (!task.clockActivity) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    createTimeBlockMenu({ event, task, workspaceFacade, sTaskEditor });
  }
</script>

<LocalTimeBlock oncontextmenu={openActivityContextMenu} {task}>
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

<style>
  .activity-duration {
    position: absolute;
    bottom: var(--size-2-1);
    left: var(--size-4-1);

    padding: 0 3px;

    font-size: var(--font-ui-smaller);
    line-height: 1.2;
    color: var(--text-faint);

    border: 1px solid var(--text-faint);
    border-radius: var(--radius-s);
  }
</style>
