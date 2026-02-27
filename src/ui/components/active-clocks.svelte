<script lang="ts">
  import { PlaneTakeoff, Clock3 } from "lucide-svelte";

  import { getObsidianContext } from "../../context/obsidian-context";
  import { selectListProps } from "../../redux/dataview/dataview-slice";
  import { currentTimeSignal } from "../../global-store/current-time";
  import { settings } from "../../global-store/settings";
  import type { LocalTask } from "../../task-types";
  import * as m from "../../util/moment";
  import { createActiveClockMenu } from "../active-clock-menu";

  import BlockList from "./block-list.svelte";
  import LocalTimeBlock from "./local-time-block.svelte";
  import Pill from "./pill.svelte";
  import Properties from "./Properties.svelte";
  import Selectable from "./selectable.svelte";

  const { useSelector, workspaceFacade, tasksWithActiveClockProps, sTaskEditor } =
    getObsidianContext();

  const listProps = useSelector(selectListProps);

  const elapsedSinceLastActivity = $derived.by(() => {
    if ($tasksWithActiveClockProps.length > 0) {
      return undefined;
    }

    const latestEnd = Object.values($listProps)
      .flatMap((lineToProps) =>
        Object.values(lineToProps).flatMap(({ parsed }) =>
          (parsed.activities ?? []).flatMap((activity) =>
            (activity.log ?? []).flatMap((entry) =>
              entry.end ? [window.moment(entry.end)] : [],
            ),
          ),
        ),
      )
      .filter((endMoment) => endMoment.isValid())
      .sort((a, b) => b.valueOf() - a.valueOf())[0];

    if (!latestEnd) {
      return undefined;
    }

    return m.fromDiff(latestEnd, currentTimeSignal.current).humanize();
  });
</script>

<BlockList list={$tasksWithActiveClockProps}>
  {#snippet match(task: LocalTask)}
    <Selectable
      onSecondarySelect={(event) =>
        createActiveClockMenu({
          event,
          task,
          sTaskEditor,
          workspaceFacade,
        })}
    >
      {#snippet children({ use, onpointerup, state })}
        <LocalTimeBlock
          --time-block-padding="var(--size-4-1)"
          isActive={state === "secondary"}
          {onpointerup}
          {task}
          {use}
        >
          {#snippet bottomDecoration()}
            <Properties>
              
              <Pill
                key={PlaneTakeoff}
                value={task.startTime.format($settings.timestampFormat)}
              />
              <Pill
                key={Clock3}
                value={m
                  .fromDiff(task.startTime, currentTimeSignal.current)
                  .format($settings.timestampFormat)}
              />
            </Properties>
          {/snippet}
        </LocalTimeBlock>
      {/snippet}
    </Selectable>
  {/snippet}
</BlockList>

{#if $tasksWithActiveClockProps.length === 0 && elapsedSinceLastActivity}
  <div class="empty-active-clocks">
    Last timed activity ended {elapsedSinceLastActivity} ago.
  </div>
{/if}

<style>
  .empty-active-clocks {
    padding: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
</style>
