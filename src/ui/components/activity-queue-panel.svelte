<script lang="ts">
  import { Menu } from "obsidian";
  import type { STask } from "obsidian-dataview";

  import { getObsidianContext } from "../../context/obsidian-context";
  import {
    selectDataviewTasks,
    selectListProps,
  } from "../../redux/dataview/dataview-slice";
  import { type ActivitySelection } from "../../create-update-handler";
  import {
    getActivityAttributeFields,
    getActivityAttributeValues,
    getActivityDefinitions,
    getActivityLabel,
    normalizeActivityName,
  } from "../../util/activity-definitions";
  import { getResourceFilesForField } from "../../util/activity-resources";
  import type { Activity } from "../../util/props";

  import Tree from "./obsidian/tree.svelte";

  type QueueSuggestion = {
    key: string;
    displayText: string;
    activityName: string;
    initialValues: Record<string, string | number | undefined>;
    recency: number;
    needsFile?: boolean;
  };

  const { app, getAllActivities, startActivityWithSelection, useSelector } =
    getObsidianContext();

  let inProgressByActivity = $state<Record<string, QueueSuggestion[]>>({});
  let queuedByActivity = $state<Record<string, QueueSuggestion[]>>({});
  const dataviewTasks = useSelector(selectDataviewTasks);
  const listProps = useSelector(selectListProps);

  function getActivityTimestamp(value?: string) {
    if (!value) {
      return Number.NEGATIVE_INFINITY;
    }

    const timestamp = Date.parse(value);

    return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
  }

  function getActivityRecency(activity: Activity) {
    return (activity.log ?? []).reduce(
      (latest, entry) =>
        Math.max(
          latest,
          getActivityTimestamp(entry.end),
          getActivityTimestamp(entry.start),
        ),
      Number.NEGATIVE_INFINITY,
    );
  }

  function getRecentActivities(activityName: string) {
    const normalizedActivityName = normalizeActivityName(activityName);

    return getAllActivities()
      .filter(
        (activity) =>
          normalizeActivityName(activity.activity) === normalizedActivityName,
      )
      .map((activity, index) => ({
        activity,
        recency: getActivityRecency(activity),
        index,
      }))
      .sort((a, b) => {
        if (a.recency !== b.recency) {
          return b.recency - a.recency;
        }

        return b.index - a.index;
      });
  }

  function getLatestActivityForResource(
    recentActivities: ReturnType<typeof getRecentActivities>,
    activityName: string,
    mainKey: string | undefined,
    value: string,
  ) {
    if (!mainKey) {
      return undefined;
    }

    return recentActivities.find(({ activity }) => {
      const values = getActivityAttributeValues(activityName, activity);

      return String(values[mainKey] ?? "") === value;
    });
  }

  function getInitialValues(props: {
    activityName: string;
    definition: ReturnType<typeof getActivityDefinitions>[number];
    resourceKey: string;
    resourceValue: string;
    recentActivities: ReturnType<typeof getRecentActivities>;
  }) {
    const {
      activityName,
      definition,
      resourceKey,
      resourceValue,
      recentActivities,
    } = props;
    const initialValues: Record<string, string | number | undefined> = {
      [resourceKey]: resourceValue,
    };
    const latest = getLatestActivityForResource(
      recentActivities,
      activityName,
      definition?.attributes?.mainKey,
      resourceValue,
    );

    if (!latest) {
      for (const range of definition?.attributes?.ranges ?? []) {
        initialValues[range.start] = 1;
      }

      return initialValues;
    }

    const latestValues = getActivityAttributeValues(
      activityName,
      latest.activity,
    );

    for (const range of definition?.attributes?.ranges ?? []) {
      const endValue = latestValues[range.end];

      initialValues[range.start] =
        typeof endValue === "number" ? endValue + 1 : 1;
    }

    return initialValues;
  }

  function getRangeSuffix(
    definition: ReturnType<typeof getActivityDefinitions>[number],
    initialValues: Record<string, string | number | undefined>,
  ) {
    const range = definition.attributes?.ranges?.[0];

    if (!range) {
      return "";
    }

    const startValue = initialValues[range.start];

    if (typeof startValue !== "number" && typeof startValue !== "string") {
      return "";
    }

    const startField = getActivityAttributeFields(
      definition.name,
      "start",
    ).find(({ key }) => key === range.start);

    return ` - ${startField?.label ?? range.start}: ${startValue}`;
  }

  function hasTaskTag(task: STask) {
    return (
      task.tags.some(
        (tag: string) => tag.replace(/^#/, "").toLowerCase() === "task",
      ) || /(^|\s)#task(?=\s|$)/i.test(task.text)
    );
  }

  function refresh() {
    const inProgress: Record<string, QueueSuggestion[]> = {};
    const queued: Record<string, QueueSuggestion[]> = {};

    for (const definition of getActivityDefinitions()) {
      const activityName = definition.name;
      const fields = getActivityAttributeFields(activityName, "start").filter(
        (field) => field.resourceTag,
      );

      if (fields.length === 0) {
        continue;
      }

      const recentActivities = getRecentActivities(activityName);

      for (const field of fields) {
        const resourceFiles = getResourceFilesForField(app, field);
        const resourceNames = new Set(
          resourceFiles.flatMap((resource) =>
            [resource.name, resource.file.name, ...resource.aliases].map(
              (name) => name.trim().toLowerCase(),
            ),
          ),
        );

        for (const resource of resourceFiles) {
          if (
            resource.status !== "in progress" &&
            resource.status !== "queued"
          ) {
            continue;
          }

          const latest = getLatestActivityForResource(
            recentActivities,
            activityName,
            definition.attributes?.mainKey,
            resource.name,
          );
          const initialValues = getInitialValues({
            activityName,
            definition,
            resourceKey: field.key,
            resourceValue: resource.name,
            recentActivities,
          });
          const item: QueueSuggestion = {
            key: `${activityName}:${field.key}:${resource.file.path}`,
            displayText: `${getActivityLabel(activityName)} - ${resource.name}${getRangeSuffix(definition, initialValues)}`,
            activityName,
            initialValues,
            recency: latest?.recency ?? Number.NEGATIVE_INFINITY,
          };

          if (resource.status === "in progress") {
            inProgress[activityName] = [
              ...(inProgress[activityName] ?? []),
              item,
            ];
          }

          if (resource.status === "queued") {
            queued[activityName] = [...(queued[activityName] ?? []), item];
          }
        }

        const missingResourceNames = new Set<string>();

        for (const { activity, recency } of recentActivities) {
          const values = getActivityAttributeValues(activityName, activity);
          const value = values[field.key];

          if (typeof value !== "string" && typeof value !== "number") {
            continue;
          }

          const resourceName = String(value).trim();

          if (!resourceName) {
            continue;
          }

          const normalizedResourceName = resourceName.toLowerCase();

          if (
            resourceNames.has(normalizedResourceName) ||
            missingResourceNames.has(normalizedResourceName)
          ) {
            continue;
          }

          missingResourceNames.add(normalizedResourceName);

          const initialValues = getInitialValues({
            activityName,
            definition,
            resourceKey: field.key,
            resourceValue: resourceName,
            recentActivities,
          });
          const item: QueueSuggestion = {
            key: `${activityName}:${field.key}:missing:${normalizedResourceName}`,
            displayText: `${getActivityLabel(activityName)} - ${resourceName}${getRangeSuffix(definition, initialValues)} [Needs File]`,
            activityName,
            initialValues,
            recency,
            needsFile: true,
          };

          inProgress[activityName] = [
            ...(inProgress[activityName] ?? []),
            item,
          ];
        }
      }
    }

    const sortGroup = (groups: Record<string, QueueSuggestion[]>) =>
      Object.fromEntries(
        Object.entries(groups)
          .sort(([, a], [, b]) => (b[0]?.recency ?? 0) - (a[0]?.recency ?? 0))
          .map(([key, values]) => [
            key,
            [...values].sort((a, b) => b.recency - a.recency),
          ]),
      );

    inProgressByActivity = sortGroup(inProgress);
    queuedByActivity = sortGroup(queued);
  }

  let openTasks = $derived(
    $dataviewTasks
      .filter((task) => task.task && !task.completed && hasTaskTag(task))
      .slice(0, 100)
      .map((task) => ({
        text: task.text,
        path: task.path,
        line: task.line + 1,
      })),
  );

  async function openTask(task: { path: string; line: number }) {
    const file = app.metadataCache.getFirstLinkpathDest(task.path, task.path);
    if (!file) return;

    await app.workspace.getLeaf("tab").openFile(file, {
      eState: {
        line: Math.max(task.line - 1, 0),
      },
    });
  }

  function onContextMenu(event: MouseEvent, selection: ActivitySelection) {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Start activity")
        .setIcon("play")
        .onClick(() => {
          void startActivityWithSelection(selection);
        }),
    );
    menu.showAtMouseEvent(event);
  }

  function getEntryCount(groups: Record<string, QueueSuggestion[]>) {
    return Object.values(groups).reduce(
      (total, entries) => total + entries.length,
      0,
    );
  }

  $effect(() => {
    $listProps;
    $dataviewTasks;
    refresh();
  });
</script>

<div class="activity-queue-panel">
  <div class="top-level-tree">
    <Tree isInitiallyOpen title="▶️ In Progress">
      {#snippet flair()}
        {String(getEntryCount(inProgressByActivity))}
      {/snippet}
      {#if Object.keys(inProgressByActivity).length === 0}
        <div class="empty-entry">None</div>
      {:else}
        {#each Object.entries(inProgressByActivity) as [activity, entries]}
          <Tree isInitiallyOpen title={getActivityLabel(activity)}>
            {#snippet flair()}
              {String(entries.length)}
            {/snippet}
            <div class="entry-list">
              {#each entries as entry (entry.key)}
                <div
                  class:needs-file={entry.needsFile}
                  class="entry"
                  oncontextmenu={(event) =>
                    onContextMenu(event, {
                      activityName: entry.activityName,
                      initialValues: entry.initialValues,
                    })}
                >
                  {entry.displayText}
                </div>
              {/each}
            </div>
          </Tree>
        {/each}
      {/if}
    </Tree>
  </div>

  <div class="top-level-tree">
    <Tree isInitiallyOpen title="⏳ Queued">
      {#snippet flair()}
        {String(getEntryCount(queuedByActivity))}
      {/snippet}
      {#if Object.keys(queuedByActivity).length === 0}
        <div class="empty-entry">None</div>
      {:else}
        {#each Object.entries(queuedByActivity) as [activity, entries]}
          <Tree isInitiallyOpen title={getActivityLabel(activity)}>
            {#snippet flair()}
              {String(entries.length)}
            {/snippet}
            <div class="entry-list">
              {#each entries as entry (entry.key)}
                <div
                  class="entry"
                  oncontextmenu={(event) =>
                    onContextMenu(event, {
                      activityName: entry.activityName,
                      initialValues: entry.initialValues,
                    })}
                >
                  {entry.displayText}
                </div>
              {/each}
            </div>
          </Tree>
        {/each}
      {/if}
    </Tree>
  </div>

  <div class="top-level-tree">
    <Tree isInitiallyOpen title="📋 Open Tasks">
      {#snippet flair()}
        {String(openTasks.length)}
      {/snippet}
      {#if openTasks.length === 0}
        <div class="empty-entry">None</div>
      {:else}
        <div class="entry-list">
          {#each openTasks as task (`${task.path}:${task.line}`)}
            <div class="entry" onclick={() => void openTask(task)}>
              {task.text}
            </div>
          {/each}
        </div>
      {/if}
    </Tree>
  </div>
</div>

<style>
  .activity-queue-panel {
    display: flex;
    flex-direction: column;
  }
  .top-level-tree {
    border-bottom: 2px solid var(--background-modifier-border);
  }
  .top-level-tree:first-child {
    border-top: 2px solid var(--background-modifier-border);
  }
  .activity-queue-panel :global(.tree-item-self) {
    align-items: center;
  }
  .activity-queue-panel
    :global(.tree-container .tree-container .tree-header-container),
  .activity-queue-panel :global(.tree-container .tree-container .entry-list),
  .activity-queue-panel :global(.tree-container .tree-container .empty-entry) {
    padding-left: var(--size-4-4);
  }
  .top-level-tree
    :global(
      > .tree-container
        > .tree-header-container
        > .tree-item-self
        > .tree-item-inner
    ) {
    font-size: calc(var(--font-ui-medium) * 2);
  }
  .entry {
    position: relative;

    padding: var(--size-2-1) var(--size-4-2) var(--size-2-1) var(--size-4-8);

    font-size: var(--font-ui-small);
  }
  .entry + .entry::before {
    content: "";

    position: absolute;
    top: 0;
    right: 0;
    left: var(--size-4-8);

    border-top: 1px solid var(--background-modifier-border);
  }
  .entry-list {
    display: flex;
    flex-direction: column;
  }
  .empty-entry {
    padding: var(--size-2-1) var(--size-4-2) var(--size-2-1) var(--size-4-8);

    font-size: var(--font-ui-small);
    color: var(--text-faint);
  }
  .needs-file {
    color: var(--text-error);
  }
</style>
