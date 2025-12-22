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

const activitySchema = z.object({
  activity: z.string(),
  log: z.array(logEntrySchema).optional(),
  notes: z.string().optional(),
  reading: readingActivityDetailsSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type Activity = z.infer<typeof activitySchema>;

const activitiesSchema = z.array(activitySchema);

export const propsSchema = z.looseObject({
  activities: activitiesSchema.optional(),
});

export type Props = z.infer<typeof propsSchema>;

const defaultActivityName = "Activity";

function getActivities(props: Props): Activity[] {
  return props.activities ?? [];
}

function getOrCreateActivities(props: Props): Activity[] {
  const activities = getActivities(props);

  if (activities.length > 0) {
    return activities.map((activity) => ({
      ...activity,
      log: [...(activity.log ?? [])],
    }));
  }

  return [{ activity: defaultActivityName, log: [] }];
}

export function isWithOpenClock(props?: Props) {
  return Boolean(
    props?.activities?.some((activity) =>
      activity.log?.some((entry) => !entry.end),
    ),
  );
}

export function createPropsWithOpenClock(): Props {
  return addOpenClock({});
}

export function addOpenClock(props: Props): Props {
  if (isWithOpenClock(props)) {
    throw new Error("There is already an open clock");
  }

  const activities = getOrCreateActivities(props);
  const [firstActivity, ...rest] = activities;

  const updatedFirstActivity: Activity = {
    ...firstActivity,
    log: [
      ...(firstActivity.log ?? []),
      {
        start: window.moment().format(clockFormat),
      },
    ],
  };

  return {
    ...props,
    activities: [updatedFirstActivity, ...rest],
  };
}

export function cancelOpenClock(props: Props): Props {
  const activities = getActivities(props);
  const activityWithOpenClockIndex = activities.findIndex((activity) =>
    activity.log?.some((it) => !it.end),
  );

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

export function clockOut(props: Props): Props {
  const activities = getActivities(props);
  const activityWithOpenClockIndex = activities.findIndex((activity) =>
    activity.log?.some((it) => !it.end),
  );

  if (activityWithOpenClockIndex === -1) {
    throw new Error("There is no open clock");
  }

  const activityWithOpenClock = activities[activityWithOpenClockIndex];
  const log = activityWithOpenClock.log;

  if (!log) {
    throw new Error("There is no log under cursor");
  }

  const openClockIndex = log.findIndex((it) => !it.end);

  const updatedOpenClock = {
    ...log[openClockIndex],
    end: window.moment().format(clockFormat),
  };

  const updatedActivity: Activity = {
    ...activityWithOpenClock,
    log: log.with(openClockIndex, updatedOpenClock),
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

export function toMarkdown(props: Props) {
  return createCodeBlock({ language: "yaml", text: stringifyYaml(props) });
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
