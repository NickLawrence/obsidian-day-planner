import { takeWhile } from "lodash/fp";
import { stringifyYaml } from "obsidian";
import { z } from "zod";

import { clockFormat, codeFence } from "../constants";
import {
  keylessScheduledPropRegExp,
  propRegexp,
  scheduledPropRegExp,
  shortScheduledPropRegExp,
} from "../regexp";

import { getIndentationForListParagraph } from "./dataview";
import { createCodeBlock, createIndentation, indent } from "./markdown";
import { appendText } from "./task-utils";
import {
  type ActivityAttributeField,
  type ActivityAttributesDefinition,
  getActivityDefinitions,
} from "./activity-definitions";

export const taskActivityType = "task";

const dateTimeSchema = z
  .string()
  .refine((it) => window.moment(it, window.moment.ISO_8601, true).isValid());

const logEntrySchema = z.object({
  start: dateTimeSchema,
  end: dateTimeSchema.optional(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

const activityFieldSchemas = {
  text: () => z.string(),
  textarea: () => z.string(),
  number: () => z.number(),
} satisfies Record<ActivityAttributeField["type"], () => z.ZodTypeAny>;

function buildActivityFieldSchema(field: ActivityAttributeField) {
  return activityFieldSchemas[field.type]().optional();
}

function buildActivityAttributeSchema(attributes: ActivityAttributesDefinition) {
  const fields = [...attributes.start, ...attributes.end];
  const shape = Object.fromEntries(
    fields.map((field) => [field.key, buildActivityFieldSchema(field)]),
  );

  return z.object(shape).optional();
}

const activityAttributeSchemas = getActivityDefinitions().reduce<
  Record<string, z.ZodTypeAny>
>((accumulator, definition) => {
  if (!definition.attributes) {
    return accumulator;
  }

  return {
    ...accumulator,
    [definition.attributes.key]: buildActivityAttributeSchema(
      definition.attributes,
    ),
  };
}, {});

const activitySchema = z
  .object({
    activity: z.string(),
    log: z.array(logEntrySchema).optional(),
    taskIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
    quality: z.number().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    ...activityAttributeSchemas,
  })
  .passthrough()
  .transform(({ taskIds, ...rest }) => ({
    ...rest,
    taskIds: taskIds ?? [],
  }));

export type Activity = z.infer<typeof activitySchema>;

const activitiesSchema = z.array(activitySchema);

export const propsSchema = z.looseObject({
  activities: activitiesSchema.optional(),
});

export type Props = z.infer<typeof propsSchema>;

export function isWithOpenClock(props?: Props) {
  return Boolean(
    props?.activities?.some((activity) =>
      activity.log?.some((entry) => !entry.end),
    ),
  );
}

export function getTaskIdFromActivity(activity: Activity) {
  return activity.taskIds[0];
}

function getActivities(props: Props): Activity[] {
  return (props.activities ?? []).map((activity) => ({
    ...activity,
    taskIds: activity.taskIds ?? [],
  }));
}

function getActivitiesCopy(props: Props): Activity[] {
  return getActivities(props).map((activity) => ({
    ...activity,
    log: [...(activity.log ?? [])],
  }));
}

function mergeActivityDetails(
  activity: Activity,
  updates?: Record<string, unknown>,
): Activity {
  if (!updates) {
    return activity;
  }

  return Object.entries(updates).reduce<Activity>((result, [key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = result[key];
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        return {
          ...result,
          [key]: {
            ...(existing as Record<string, unknown>),
            ...(value as Record<string, unknown>),
          },
        };
      }
    }

    return {
      ...result,
      [key]: value,
    };
  }, activity);
}

function findActivityByTaskId(
  activities: Activity[],
  taskId: string,
) {
  const existingIndex = activities.findIndex(
    (activity) => activity.taskIds.includes(taskId),
  );

  const existing = activities[existingIndex];

  if (existing) {
    return {
      index: existingIndex,
      activity: existing,
    };
  }

  return {
    index: activities.length,
    activity: {
      activity: taskActivityType,
      taskIds: [taskId],
      log: [],
    },
  };
}

export function createPropsWithOpenClock(props: {
  taskId: string;
  activityName: string;
}): Props {
  return addOpenClock({}, props);
}

export function addOpenClock(
  props: Props,
  task: { taskId: string; activityName: string },
): Props {
  const activities = getActivitiesCopy(props);
  const { activity, index } = findActivityByTaskId(
    activities,
    task.taskId,
  );

  if (activity.log?.some((entry) => !entry.end)) {
    throw new Error("There is already an open clock");
  }

  const updatedActivity: Activity = {
    ...activity,
    activity: taskActivityType,
    taskIds: activity.taskIds.length > 0 ? activity.taskIds : [task.taskId],
    log: [
      ...(activity.log ?? []),
      {
        start: window.moment().format(clockFormat),
      },
    ],
  };

  const updatedActivities =
    index < activities.length
      ? activities.with(index, updatedActivity)
      : activities.concat(updatedActivity);

  return {
    ...props,
    activities: updatedActivities,
  };
}

export function startActivityLog(
  props: Props,
  activityName: string,
  attributes?: Record<string, unknown>,
): Props {
  const activities = getActivitiesCopy(props);

  const updatedActivity: Activity = mergeActivityDetails(
    {
      activity: activityName,
      taskIds: [],
      log: [
        {
          start: window.moment().format(clockFormat),
        },
      ],
    },
    attributes,
  );

  return {
    ...props,
    activities: activities.concat(updatedActivity),
  };
}

export function addTaskToOpenActivity(
  props: Props,
  taskId: string,
): Props {
  const activities = getActivitiesCopy(props);
  const openActivityIndex = activities.findIndex((activity) =>
    activity.log?.some((entry) => !entry.end),
  );

  if (openActivityIndex === -1) {
    throw new Error("There is no open clock");
  }

  const openActivity = activities[openActivityIndex];
  const currentTaskIds = openActivity.taskIds ?? [];

  if (currentTaskIds.includes(taskId)) {
    return props;
  }

  const updatedActivities = activities.with(openActivityIndex, {
    ...openActivity,
    taskIds: currentTaskIds.concat(taskId),
  });

  return {
    ...props,
    activities: updatedActivities,
  };
}

export function appendNoteToActivity(
  props: Props,
  activityIndex: number,
  note: string,
): Props {
  const activities = getActivitiesCopy(props);

  if (activityIndex < 0 || activityIndex >= activities.length) {
    throw new Error("There is no activity");
  }

  const activity = activities[activityIndex];
  const trimmedNote = note.trim();

  if (!trimmedNote) {
    return props;
  }

  const updatedActivities = activities.with(activityIndex, {
    ...activity,
    notes: activity.notes ? `${activity.notes}\n${trimmedNote}` : trimmedNote,
  });

  return {
    ...props,
    activities: updatedActivities,
  };
}

export function cancelOpenClock(props: Props, taskId: string): Props {
  const activities = getActivitiesCopy(props);
  const activityWithOpenClockIndex = activities.findIndex((activity) => {
    return activity.taskIds.includes(taskId) && activity.log?.some((it) => !it.end);
  });

  if (activityWithOpenClockIndex === -1) {
    throw new Error("There is no open clock");
  }

  const activityWithOpenClock = activities[activityWithOpenClockIndex];
  const log = activityWithOpenClock.log;

  if (!log) {
    throw new Error("There is no log");
  }

  const openClockIndex = log.findIndex((it) => !it.end);

  const updatedActivity: Activity = {
    ...activityWithOpenClock,
    log: log.toSpliced(openClockIndex, 1),
  };

  const updatedActivities = activities.with(
    activityWithOpenClockIndex,
    updatedActivity,
  );

  return {
    ...props,
    activities: updatedActivities,
  };
}

export function clockOut(
  props: Props,
  activityIndex: number,
  attributes?: Record<string, unknown>,
): Props {
  const activities = getActivitiesCopy(props);

  if (activityIndex < 0 || activityIndex >= activities.length) {
    throw new Error("There is no open clock");
  }

  const activityWithOpenClock = activities[activityIndex];
  const log = activityWithOpenClock?.log;

  if (!log) {
    throw new Error("There is no log");
  }

  const openClockIndex = log.findIndex((it) => !it.end);

  if (openClockIndex === -1) {
    throw new Error("There is no open clock");
  }

  const updatedActivity: Activity = mergeActivityDetails(
    {
      ...activityWithOpenClock,
      log: log.toSpliced(openClockIndex, 1, {
        ...log[openClockIndex],
        end: window.moment().format(clockFormat),
      }),
    },
    attributes,
  );

  const updatedActivities = activities.with(
    activityIndex,
    updatedActivity,
  );

  return {
    ...props,
    activities: updatedActivities,
  };
}

export function toMarkdown(props: Props) {
  const yamlReadyProps = {
    ...props,
    activities: props.activities?.map(({ taskIds, ...activity }) => ({
      ...activity,
      ...(taskIds ? { taskIds } : {}),
    })),
  };

  return createCodeBlock({
    language: "activities",
    text: stringifyYaml(yamlReadyProps),
  });
}

export function createProp(
  key: string,
  value: string,
  type: "default" | "keyless" = "default",
) {
  if (type === "default") {
    return `[${key}::${value}]`;
  }

  return `(${key}::${value})`;
}

export function updateProp(
  line: string,
  updateFn: (previous: string) => string,
) {
  const match = [...line.matchAll(propRegexp)];

  if (match.length === 0) {
    throw new Error(`Did not find a prop in line: '${line}'`);
  }

  const captureGroups = match[0];
  const [, key, previousValue] = captureGroups;

  return `[${key}::${updateFn(previousValue)}]`;
}

export function deleteProps(text: string) {
  return takeWhile(
    (line) => !line.trimStart().startsWith(codeFence),
    text.split("\n"),
  )
    .join("\n")
    .replaceAll(propRegexp, "")
    .trim();
}

export function updateScheduledPropInText(text: string, dayKey: string) {
  return text
    .replace(shortScheduledPropRegExp, `$1${dayKey}`)
    .replace(scheduledPropRegExp, `$1${dayKey}$2`)
    .replace(keylessScheduledPropRegExp, `$1${dayKey}$2`);
}

export function addTasksPluginProp(text: string, prop: string) {
  return appendText(text, ` ${prop}`);
}

export function toIndentedMarkdown(props: Props, column: number) {
  const asMarkdown = toMarkdown(props);
  const indentation =
    createIndentation(column) + getIndentationForListParagraph();

  return indent(asMarkdown, indentation);
}
