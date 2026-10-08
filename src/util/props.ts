import { takeWhile } from "lodash/fp";
import { stringifyYaml } from "obsidian";

import { clockFormat, codeFence } from "../constants";
import {
  keylessScheduledPropRegExp,
  propRegexp,
  scheduledPropRegExp,
  shortScheduledPropRegExp,
} from "../regexp";

import type { Props } from "./activity-schema";
import {
  startActivityLog as sharedStartActivityLog,
  clockOut as sharedClockOut,
} from "./activity-state";
export { propsSchema } from "./activity-schema";
export type { Activity, LogEntry, ParsedProps, Props } from "./activity-schema";
import { getIndentationForListParagraph } from "./dataview";
import { createCodeBlock, createIndentation, indent } from "./markdown";
import { appendText } from "./task-utils";

export {
  isWithOpenClock,
  appendNoteToActivity,
  updateActivityLogEntry,
  updateActivityDetails,
  cancelOpenClockByActivityIndex,
  cancelActivityLogEntry,
} from "./activity-state";
export { closeActivityLogEntry } from "./activity-workflow";

export function startActivityLog(
  props: Props,
  activityName: string,
  attributes?: Record<string, unknown>,
): Props {
  return sharedStartActivityLog(
    props,
    activityName,
    attributes,
    window.moment().format(clockFormat),
  );
}

export function clockOut(
  props: Props,
  activityIndex: number,
  attributes?: Record<string, unknown>,
): Props {
  return sharedClockOut(
    props,
    activityIndex,
    attributes,
    window.moment().format(clockFormat),
  );
}

export function toMarkdown(props: Props) {
  return createCodeBlock({
    language: "activities",
    text: stringifyYaml(props),
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
