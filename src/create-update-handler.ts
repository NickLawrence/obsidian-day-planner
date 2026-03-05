import type { App } from "obsidian";
import { isNotVoid } from "typed-assert";

import { sortListsRecursivelyInMarkdown } from "./mdast/mdast";
import {
  createTransaction,
  getTaskDiffFromEditState,
  mapTaskDiffToUpdates,
  TransactionWriter,
} from "./service/diff-writer";
import type { PeriodicNotes } from "./service/periodic-notes";
import type { VaultFacade } from "./service/vault-facade";
import type { DayPlannerSettings } from "./settings";
import type { OnUpdateFn } from "./types";
import { type ConfirmationModalProps } from "./ui/confirmation-modal";
import { EditMode } from "./ui/hooks/use-edit/types";
import { SingleSuggestModal } from "./ui/SingleSuggestModal";
import { applyScopedUpdates } from "./util/markdown";
import {
  getActivityAttributeFields,
  getActivityAttributeValues,
  getActivityDefinition,
  getActivitySuggestions,
  normalizeActivityName,
} from "./util/activity-definitions";
import type { Activity } from "./util/props";

type ActivityNameSuggestion = {
  text: string;
  displayText?: string;
  activityName?: string;
  initialValues?: Record<string, string | number | undefined>;
};

export type ActivitySelection = {
  activityName: string;
  initialValues?: Record<string, string | number | undefined>;
};

function getActivityTimestamp(value?: string) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function getActivityRecencyScore(activity: Activity) {
  const log = activity.log ?? [];

  if (log.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return log.reduce((latest, entry) => {
    return Math.max(
      latest,
      getActivityTimestamp(entry.end),
      getActivityTimestamp(entry.start),
    );
  }, Number.NEGATIVE_INFINITY);
}

function getActivitiesByRecency(activities: Activity[]) {
  return activities
    .map((activity, index) => ({
      activity,
      recency: getActivityRecencyScore(activity),
      index,
    }))
    .sort((a, b) => {
      if (a.recency !== b.recency) {
        return b.recency - a.recency;
      }

      return b.index - a.index;
    })
    .map(({ activity }) => activity);
}

function getRecentMainKeyValues(activityName: string, activities: Activity[]) {
  const definition = getActivityDefinition(activityName);
  const mainKey = definition?.attributes?.mainKey;

  if (!mainKey) {
    return [];
  }

  const normalizedActivityName = normalizeActivityName(activityName);
  const uniqueValues = new Set<string | number>();
  const values: Array<string | number> = [];

  const sortedActivities = getActivitiesByRecency(activities);

  for (const activity of sortedActivities) {

    if (normalizeActivityName(activity.activity) !== normalizedActivityName) {
      continue;
    }

    const attributeValues = getActivityAttributeValues(activityName, activity);
    const value = attributeValues[mainKey];

    if (
      (typeof value !== "string" && typeof value !== "number") ||
      uniqueValues.has(value)
    ) {
      continue;
    }

    uniqueValues.add(value);
    values.push(value);

    if (values.length === 5) {
      break;
    }
  }

  return values;
}

function getSuggestedRangeStartValues(
  activityName: string,
  activities: Activity[],
  initialValues: Record<string, string | number | undefined>,
) {
  const definition = getActivityDefinition(activityName);
  const attributes = definition?.attributes;
  const mainKey = attributes?.mainKey;

  if (!attributes?.ranges?.length || !mainKey) {
    return initialValues;
  }

  const mainValue = initialValues[mainKey];
  const normalizedActivityName = normalizeActivityName(activityName);

  if (typeof mainValue !== "string" && typeof mainValue !== "number") {
    return initialValues;
  }

  const history = getActivitiesByRecency(activities).filter(
    (activity) => normalizeActivityName(activity.activity) === normalizedActivityName,
  );

  const updates: Record<string, string | number | undefined> = {
    ...initialValues,
  };

  for (const range of attributes.ranges) {
    const historyEntry = history.find((activity) => {
      const values = getActivityAttributeValues(activityName, activity);

      return values[mainKey] === mainValue;
    });

    if (!historyEntry) {
      continue;
    }

    const values = getActivityAttributeValues(activityName, historyEntry);
    const rangeEnd = values[range.end];

    if (typeof rangeEnd !== "number") {
      continue;
    }

    updates[range.start] = rangeEnd + 1;
  }

  return updates;
}

export function getActivitySuggestionsWithHistory(activities: Activity[]) {
  return getActivitySuggestions().flatMap((definition) => {
    const baseLabel = definition.emoji
      ? `${definition.emoji} ${definition.label}`
      : definition.label;
    const baseSuggestion: ActivityNameSuggestion = {
      text: definition.name,
      displayText: baseLabel,
      activityName: definition.name,
    };

    const recentValues = getRecentMainKeyValues(definition.name, activities);
    const mainKey = getActivityDefinition(definition.name)?.attributes?.mainKey;

    if (recentValues.length === 0 || !mainKey) {
      return [baseSuggestion];
    }

    const valueSuggestions = recentValues.map((value) => {
      const initialValues = getSuggestedRangeStartValues(
        definition.name,
        activities,
        {
          [mainKey]: value,
        },
      );
      const startRangeKey =
        getActivityDefinition(definition.name)?.attributes?.ranges?.[0]?.start;
      const startRangeValue =
        startRangeKey ? initialValues[startRangeKey] : undefined;
      const startRangeField = startRangeKey
        ? getActivityAttributeFields(definition.name, "start").find(
            ({ key }) => key === startRangeKey,
          )
        : undefined;
      const rangeSuffix =
        typeof startRangeValue === "number" || typeof startRangeValue === "string"
          ? ` - ${startRangeField?.label ?? startRangeKey}: ${startRangeValue}`
          : "";

      return {
        text: `${definition.name} - ${value}`,
        displayText: `${baseLabel} - ${value}${rangeSuffix}`,
        activityName: definition.name,
        initialValues,
      } satisfies ActivityNameSuggestion;
    });

    return [baseSuggestion, ...valueSuggestions];
  });
}

export async function getTextFromUser(app: App): Promise<string | undefined> {
  return new Promise((resolve) => {
    new SingleSuggestModal({
      app,
      getDescriptionText: (value) =>
        value.trim().length === 0
          ? "Start typing to create a task"
          : `Create item "${value}"`,
      onChooseSuggestion: async ({ text }) => {
        resolve(text);
      },
      onClose: () => {
        resolve(undefined);
      },
    }).open();
  });
}

export async function getActivityNameFromUser(
  app: App,
  activities: Activity[],
): Promise<ActivitySelection | undefined> {
  return new Promise((resolve) => {
    const suggestions = getActivitySuggestionsWithHistory(activities);

    new SingleSuggestModal<ActivityNameSuggestion>({
      app,
      getDescriptionText: (value) =>
        value.trim().length === 0
          ? "Start typing to create an activity"
          : `Start activity "${value}"`,
      getSuggestions: (query) => {
        const trimmedQuery = query.trim();
        const normalizedQuery = normalizeActivityName(query);
        const matches =
          normalizedQuery.length === 0
            ? suggestions
            : suggestions.filter((suggestion) => {
                const normalizedName = normalizeActivityName(
                  suggestion.activityName ?? suggestion.text,
                );
                const normalizedLabel = normalizeActivityName(
                  suggestion.displayText ?? suggestion.text,
                );

                return (
                  normalizedName.includes(normalizedQuery) ||
                  normalizedLabel.includes(normalizedQuery)
                );
              });

        return trimmedQuery.length > 0
          ? [{ text: query, activityName: query }, ...matches]
          : matches;
      },
      onChooseSuggestion: async ({ text, activityName, initialValues }) => {
        resolve({
          activityName: activityName ?? text,
          initialValues,
        });
      },
      onClose: () => {
        resolve(undefined);
      },
    }).open();
  });
}

export const createUpdateHandler = (props: {
  settings: () => DayPlannerSettings;
  transactionWriter: TransactionWriter;
  vaultFacade: VaultFacade;
  periodicNotes: PeriodicNotes;
  onEditCanceled: () => void;
  onEditConfirmed: () => void;
  getTextInput: () => Promise<string | undefined>;
  getConfirmationInput: (input: ConfirmationModalProps) => Promise<boolean>;
}): OnUpdateFn => {
  const {
    settings,
    transactionWriter,
    vaultFacade,
    onEditCanceled,
    onEditConfirmed,
    periodicNotes,
    getTextInput,
    getConfirmationInput,
  } = props;

  function getPathsToCreate(paths: string[]) {
    return paths.reduce<string[]>(
      (result, path) =>
        vaultFacade.checkFileExists(path) ? result : result.concat(path),
      [],
    );
  }

  return async (base, next, mode) => {
    const diff = getTaskDiffFromEditState(base, next);

    if (mode === EditMode.CREATE) {
      const created = diff.added[0];

      isNotVoid(created);

      const modalOutput = await getTextInput();

      if (!modalOutput) {
        return onEditCanceled();
      }

      diff.added[0] = { ...created, text: modalOutput };
    }

    const updates = mapTaskDiffToUpdates(diff, mode, settings(), periodicNotes);

    const afterEach = settings().sortTasksInPlanAfterEdit
      ? (contents: string) =>
          applyScopedUpdates(
            contents,
            settings().plannerHeading,
            sortListsRecursivelyInMarkdown,
          )
      : undefined;

    const transaction = createTransaction({
      updates,
      afterEach,
      settings: settings(),
    });

    const updatePaths = [...new Set([...transaction.map(({ path }) => path)])];

    const needToCreate = getPathsToCreate(updatePaths);

    if (needToCreate.length > 0) {
      const confirmed = await getConfirmationInput({
        title: "Need to create files",
        text: `The following files need to be created: ${needToCreate.join("; ")}`,
        cta: "Create",
      });

      if (!confirmed) {
        return onEditCanceled();
      }

      await Promise.all(
        needToCreate.map(async (path) => {
          const date = periodicNotes.getDateFromPath(path, "day");

          isNotVoid(date);

          await periodicNotes.createDailyNote(date);
        }),
      );
    }

    await transactionWriter.writeTransaction(transaction);

    return onEditConfirmed();
  };
};
