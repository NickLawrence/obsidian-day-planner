<script lang="ts">
  import type { Snippet } from "svelte";

  import type { LocalTask } from "../../task-types";
  import { hoverPreview } from "../actions/hover-preview";
  import type { HTMLActionArray } from "../actions/use-actions";

  import RenderedMarkdown from "./rendered-markdown.svelte";
  import TimeBlockBase from "./time-block-base.svelte";

  const qualityEmojiByScore = [
    "😭",
    "😢",
    "🙁",
    "😟",
    "😕",
    "😐",
    "🙂",
    "😊",
    "😄",
    "😁",
    "🤩",
  ];

  type ClockActivityDisplay = {
    title?: string;
    notes?: string;
    quality?: number;
  };

  const {
    task,
    bottomDecoration,
    isActive = false,
    use = [],
    onpointerup,
  }: {
    isActive?: boolean;
    task: LocalTask & { clockActivity?: ClockActivityDisplay };
    bottomDecoration?: Snippet;
    use?: HTMLActionArray;
    onpointerup?: (event: PointerEvent) => void;
  } = $props();

  const qualityBadgeText = $derived.by(() => {
    const quality = task.clockActivity?.quality;

    if (typeof quality !== "number") {
      return undefined;
    }

    const emojiIndex = Math.min(10, Math.max(0, Math.round(quality)));
    return `${quality} ${qualityEmojiByScore[emojiIndex]}`;
  });
</script>

<TimeBlockBase
  --time-block-border-color-override={isActive ? "var(--color-accent)" : ""}
  --time-block-box-shadow={isActive
    ? "var(--shadow-stationary), var(--shadow-border-accent)"
    : ""}
  {onpointerup}
  {task}
  use={[...use, hoverPreview(task)]}
>
  {#if task.clockActivity}
    <div class="activity-content planner-sticky-block-content">
      <div class="activity-header">
        <div class="activity-title">
          {task.clockActivity.title ?? task.text}
        </div>
        {#if qualityBadgeText}
          <div class="quality-badge">{qualityBadgeText}</div>
        {/if}
      </div>
      {#if task.clockActivity.notes}
        <div class="activity-notes">{task.clockActivity.notes}</div>
      {/if}
    </div>
  {:else}
    <RenderedMarkdown {task} />
  {/if}
  {@render bottomDecoration?.()}
</TimeBlockBase>

<style>
  .activity-content {
    position: relative;
    display: flex;
    flex: 1 0 0;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    min-height: 0;
    overflow: hidden;
    padding: var(--size-2-1) var(--size-4-1);
    color: var(--text-normal);
  }

  .activity-header {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  .activity-title {
    display: block;
    flex: 1 1 0;
    width: 0;
    min-width: 0;
    max-width: 100%;
    min-height: 1.3em;
    overflow: hidden;
    font-weight: var(--font-semibold);
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quality-badge {
    flex: 0 0 auto;
    max-width: 45%;
    overflow: hidden;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-notes {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    min-height: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    white-space: normal;
  }
</style>
