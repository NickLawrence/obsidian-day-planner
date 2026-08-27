<script lang="ts">
  import { getObsidianContext } from "../../context/obsidian-context";
  import type { LocalTask } from "../../task-types";
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

<LocalTimeBlock oncontextmenu={openActivityContextMenu} {task} />
