<script lang="ts">
  import { FileText } from "lucide-svelte";
  import type { Snippet } from "svelte";

  import { getObsidianContext } from "../../context/obsidian-context";
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
    resourcePath?: string;
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

  const { workspaceFacade } = getObsidianContext();

  const qualityBadgeText = $derived.by(() => {
    const quality = task.clockActivity?.quality;

    if (typeof quality !== "number") {
      return undefined;
    }

    const emojiIndex = Math.min(10, Math.max(0, Math.round(quality)));
    return `${quality} ${qualityEmojiByScore[emojiIndex]}`;
  });

  function stopResourceButtonEvent(event: MouseEvent | PointerEvent) {
    event.stopPropagation();
  }

  async function openResourceFile(event: MouseEvent) {
    stopResourceButtonEvent(event);

    const resourcePath = task.clockActivity?.resourcePath;

    if (!resourcePath) {
      return;
    }

    await workspaceFacade.openFileByPath(resourcePath);
  }
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
  {#if task.clockActivity?.resourcePath}
    <button
      class="activity-resource-link"
      type="button"
      aria-label="Open resource file"
      title="Open resource file"
      onpointerdown={stopResourceButtonEvent}
      onpointerup={stopResourceButtonEvent}
      onclick={openResourceFile}
    >
      <FileText aria-hidden="true" size={14} />
    </button>
  {/if}
</TimeBlockBase>

<style>
  .activity-content {
    position: relative;

    overflow: hidden;
    display: flex;
    flex: 1 0 0;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
    max-width: 100%;
    min-height: 0;
    padding: var(--size-2-1) var(--size-4-1);

    color: var(--text-normal);
  }

  .activity-header {
    overflow: hidden;
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    align-items: flex-start;

    min-width: 0;
    max-width: 100%;
  }

  .activity-title {
    overflow: hidden;
    display: block;
    flex: 1 1 0;

    width: 0;
    min-width: 0;
    max-width: 100%;
    min-height: 1.3em;

    font-weight: var(--font-semibold);
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quality-badge {
    overflow: hidden;
    flex: 0 0 auto;

    max-width: 45%;

    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-notes {
    overflow: hidden;
    flex: 1 1 auto;

    min-width: 0;
    max-width: 100%;
    min-height: 0;

    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .activity-resource-link {
    position: absolute;
    z-index: 1;
    right: var(--size-2-1);
    bottom: var(--size-2-1);

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    padding: 0;

    color: var(--text-muted);

    background: var(--background-modifier-hover);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .activity-resource-link:hover,
  .activity-resource-link:focus-visible {
    color: var(--text-normal);
    background: var(--background-modifier-active-hover);
  }
</style>
