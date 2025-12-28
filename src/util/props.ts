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

export const taskActivityType = "task";

const dateTimeSchema = z
  .string()
  .refine((it) => window.moment(it, window.moment.ISO_8601, true).isValid());

const logEntrySchema = z.object({
  start: dateTimeSchema,
  end: dateTimeSchema.optional(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

const readingActivityDetailsSchema = z.object({
  start_page: z.number(),
  end_page: z.number(),
});

const activitySchema = z
  .object({
    activity: z.string(),
    taskId: z.string().optional(),
    task_id: z.string().optional(),
    log: z.array(logEntrySchema).optional(),
    notes: z.string().optional(),
    reading: readingActivityDetailsSchema.optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .transform(({ taskId, task_id, ...rest }) => ({
    ...rest,
    taskId: taskId || task_id,
  }));

export type Activity = Omit<z.infer<typeof activitySchema>, "task_id">;

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
  return activity.taskId;
}

function getActivities(props: Props): Activity[] {
  return props.activities ?? [];
}

function getActivitiesCopy(props: Props): Activity[] {
  return getActivities(props).map((activity) => ({
    ...activity,
    log: [...(activity.log ?? [])],
  }));
}

function findActivityByTaskId(
  activities: Activity[],
  taskId: string,
  activityName: string,
) {
  const existingIndex = activities.findIndex(
    (activity) => activity.taskId === taskId,
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
      taskId,
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
    task.activityName,
  );

  if (activity.log?.some((entry) => !entry.end)) {
    throw new Error("There is already an open clock");
  }

  const updatedActivity: Activity = {
    ...activity,
    activity: taskActivityType,
    taskId: task.taskId,
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

export function startActivityLog(props: Props, activityName: string): Props {
  const activities = getActivitiesCopy(props);

  const updatedActivity: Activity = {
    taskId: undefined,
    activity: activityName,
    log: [
      {
        start: window.moment().format(clockFormat),
      },
    ],
  };

  return {
    ...props,
    activities: activities.concat(updatedActivity),
  };
}

export function cancelOpenClock(props: Props, taskId: string): Props {
  const activities = getActivitiesCopy(props);
  const activityWithOpenClockIndex = activities.findIndex((activity) => {
    return activity.taskId === taskId && activity.log?.some((it) => !it.end);
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

export function clockOut(props: Props, activityIndex: number): Props {
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

  const updatedActivity: Activity = {
    ...activityWithOpenClock,
    log: log.toSpliced(openClockIndex, 1, {
      ...log[openClockIndex],
      end: window.moment().format(clockFormat),
    }),
  };

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
    activities: props.activities?.map(({ taskId, ...activity }) => ({
      ...activity,
      ...(taskId ? { task_id: taskId } : {}),
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
