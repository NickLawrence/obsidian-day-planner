import { dump, load, JSON_SCHEMA } from "js-yaml";
import {
  readActivityFile,
  readResourceFile,
  createActivityWeekFiles,
  getResourceNamesByFieldKey,
  type ActivityYamlCodec,
  type ActivityResourceMetadata,
  type Activity,
  type ActivityAttributeField,
} from "../../../src/shared/activity";
import type { ActivityEntry } from "./activity-notifications";

export type ResourceFile = ActivityResourceMetadata;

export const activityYaml: ActivityYamlCodec = {
  parse: (contents) => load(contents, { schema: JSON_SCHEMA }),
  stringify: (data) => dump(data, { noRefs: true, lineWidth: -1 }),
};

export function parseActivityFile(contents: string): Activity[] {
  return readActivityFile(contents, activityYaml);
}

export function parseResourceFile(
  filename: string,
  contents: string,
): ResourceFile {
  return readResourceFile(filename, contents, activityYaml);
}

export function resourceOptions(
  fields: ActivityAttributeField[],
  resources: ResourceFile[],
) {
  return getResourceNamesByFieldKey(fields, resources);
}

export function serializeActivityWeeks(entries: ActivityEntry[]) {
  return createActivityWeekFiles(
    entries.map(({ record }) => record),
    activityYaml,
  );
}
