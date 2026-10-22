<script lang="ts">
  import { getObsidianContext } from "../../context/obsidian-context";
  import type { LocalTask } from "../../task-types";
  import { formatDuration } from "../../util/duration";
  import type { Activity } from "../../util/props";
  import { createTimeBlockMenu } from "../time-block-menu";

  import LocalTimeBlock from "./local-time-block.svelte";
  import Selectable from "./selectable.svelte";
  import TimeBlockDuration from "./time-block-duration.svelte";

  const { task }: { task: LocalTask & { clockActivity?: Activity } } = $props();

  const { workspaceFacade, activityEditor } = getObsidianContext();

  function openActivityContextMenu(
    event: MouseEvent | PointerEvent | TouchEvent,
  ) {
    if (!task.clockActivity) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    createTimeBlockMenu({ event, task, workspaceFacade, activityEditor });
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
          <TimeBlockDuration>
            {formatDuration(
              window.moment.duration(task.durationMinutes, "minutes"),
            )}
          </TimeBlockDuration>
        {/if}
      {/snippet}
    </LocalTimeBlock>
  {/snippet}
</Selectable>
