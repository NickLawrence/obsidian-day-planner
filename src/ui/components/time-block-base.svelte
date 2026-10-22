<script lang="ts">
  import { type Snippet } from "svelte";

  import { getObsidianContext } from "../../context/obsidian-context";
  import type { Task } from "../../task-types";
  import type { ActionArray } from "../actions/use-actions";
  import { useActions } from "../actions/use-actions";
  import { getColorOverride } from "../hooks/get-color-override";
  import { useColor } from "../hooks/use-color.svelte";

  interface Props {
    children: Snippet;
    task: Task;
    use?: ActionArray;
    oncontextmenu?: (event: MouseEvent) => void;
    onpointerup?: (event: PointerEvent) => void;
  }

  const {
    oncontextmenu,
    onpointerup,
    children,
    task,
    use = [],
  }: Props = $props();

  const { isDarkMode, settingsSignal } = getObsidianContext();

  const {
    properContrastColors: { normal, muted, faint },
    backgroundColor,
    borderColor,
  } = $derived(useColor({ task }));
</script>

<div class="padding" {oncontextmenu} {onpointerup}>
  <div
    style:--text-faint={faint}
    style:--text-muted={muted}
    style:--text-normal={normal}
    style:--time-block-bg-color={backgroundColor}
    style:--time-block-border-color="var(--time-block-border-color-override, {borderColor})"
    style:background-color={getColorOverride(
      task,
      isDarkMode.current,
      settingsSignal.current,
    )}
    class={[
      "content",
      isDarkMode.current && "dark",
      normal !== "inherit" && "custom-colors",
      task.truncated?.includes("left") && "truncated-left",
      task.truncated?.includes("right") && "truncated-right",
      task.truncated?.includes("bottom") && "truncated-bottom",
    ]}
    use:useActions={use}
  >
    {@render children()}
  </div>
</div>

<style>
  .padding {
    position: var(--time-block-position, static);
    top: var(--time-block-top, 0);
    left: var(--time-block-left, 0);

    display: flex;
    grid-column: var(--time-block-grid-column, unset);

    width: var(--time-block-width, 100%);
    height: var(--time-block-height, auto);
    padding: var(--time-block-padding, 0 1px);

    transition: 0.05s linear;
  }

  .content {
    --time-block-shine-strength: 0.3333;
    --time-block-highlight: rgb(
      255 255 255 / calc(88% * var(--time-block-shine-strength))
    );
    --time-block-tint: calc(25% * var(--time-block-shine-strength));
    --time-block-edge-shadow: inset 0 1px 0
        rgb(255 255 255 / var(--time-block-shine-strength)),
      inset 1px 0 0
        rgb(255 255 255 / calc(70% * var(--time-block-shine-strength)));
    --time-block-drop-shadow: 2px 3px 4px rgb(0 0 0 / 16%),
      3px 7px 10px -2px rgb(0 0 0 / 12%);

    position: relative;

    flex: 1 0 0;

    font-size: var(--font-ui-small);
    text-align: left;
    overflow-wrap: anywhere;
    white-space: normal;

    background-image: radial-gradient(
        ellipse at 0 0,
        var(--time-block-highlight),
        transparent 72%
      ),
      linear-gradient(
        120deg,
        color-mix(
          in srgb,
          var(--time-block-border-color) var(--time-block-tint),
          transparent
        ),
        transparent 75%
      );
    backdrop-filter: blur(10px);
    border: 1px solid var(--time-block-border-color, var(--color-base-50));
    border-radius: 10px;
    box-shadow: var(--time-block-box-shadow, var(--time-block-edge-shadow)),
      var(--time-block-drop-shadow);
  }

  .custom-colors {
    --time-block-highlight: rgb(
      255 255 255 / calc(12% * var(--time-block-shine-strength))
    );
  }

  .dark {
    --time-block-highlight: rgb(
      255 255 255 / calc(12% * var(--time-block-shine-strength))
    );
    --time-block-tint: calc(24% * var(--time-block-shine-strength));
    --time-block-edge-shadow: inset 0 1px 0
        rgb(255 255 255 / calc(27% * var(--time-block-shine-strength))),
      inset 1px 0 0
        rgb(255 255 255 / calc(8% * var(--time-block-shine-strength)));
    --time-block-drop-shadow: 2px 3px 4px rgb(0 0 0 / 35%),
      3px 7px 10px -2px rgb(0 0 0 / 26%);
  }

  .truncated-left {
    border-left-style: dashed;
    border-left-width: 2px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .truncated-right {
    border-right-style: dashed;
    border-right-width: 2px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .truncated-bottom {
    border-bottom-style: dashed;
    border-bottom-width: 2px;
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
  }
</style>
