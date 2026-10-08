import {
  type ActivityAttributeField,
  getActivityAttributeValues,
  getActivityDefinition,
  normalizeActivityName,
} from "./activity-definitions";
import type { Activity } from "./activity-schema";

const completeStatus = "complete";

export function normalizeTag(tag: string) {
  return tag.replace(/^#/, "").trim().toLowerCase();
}

function frontmatterTagMatches(
  frontmatter: Record<string, unknown> | undefined,
  tag: string,
) {
  if (!frontmatter) return false;
  const value = frontmatter.tags ?? frontmatter.tag;
  const tags = Array.isArray(value) ? value : [value];
  return tags.some(
    (value) =>
      typeof value === "string" && normalizeTag(value) === normalizeTag(tag),
  );
}

export function getAvailableResourceNames(
  resources: { name: string; status?: string }[],
) {
  const uniqueResourceNames = new Set<string>();
  return resources
    .filter(({ status }) => status !== completeStatus)
    .map(({ name }) => name)
    .filter((resourceName) => {
      if (uniqueResourceNames.has(resourceName)) {
        return false;
      }

      uniqueResourceNames.add(resourceName);

      return true;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function resourceHasTag(
  frontmatter: Record<string, unknown> | undefined,
  tags: string[],
  resourceTag: string,
) {
  return (
    frontmatterTagMatches(frontmatter, resourceTag) ||
    tags.some((tag) => normalizeTag(tag) === normalizeTag(resourceTag))
  );
}

export function mergeActivityFieldOptions(
  activityName: string,
  activities: Activity[],
  resourceOptions: Record<string, string[]> = {},
): Record<string, string[]> {
  const options = { ...resourceOptions };
  const mainKey = getActivityDefinition(activityName)?.attributes?.mainKey;

  if (!mainKey) {
    return options;
  }

  const historicalValues = activities.flatMap((activity) => {
    if (
      normalizeActivityName(activity.activity) !==
      normalizeActivityName(activityName)
    ) {
      return [];
    }

    const value = getActivityAttributeValues(activityName, activity)[mainKey];

    if (typeof value !== "string" && typeof value !== "number") {
      return [];
    }

    const suggestion = String(value).trim();

    return suggestion ? [suggestion] : [];
  });

  options[mainKey] = [
    ...new Set([...(options[mainKey] ?? []), ...historicalValues]),
  ];

  return options;
}

export interface ActivityResourceMetadata {
  name: string;
  frontmatter?: Record<string, unknown>;
  tags?: string[];
}

export function normalizeResourceStatus(status: unknown) {
  return typeof status === "string" ? status.trim().toLowerCase() : undefined;
}

export function getResourceAliases(frontmatter?: Record<string, unknown>) {
  const value = frontmatter?.aliases ?? frontmatter?.alias;
  return (Array.isArray(value) ? value : [value])
    .filter((alias): alias is string => typeof alias === "string")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function getResourceNamesForField(
  field: ActivityAttributeField,
  resources: ActivityResourceMetadata[],
) {
  if (!field.resourceTag) return [];
  return getAvailableResourceNames(
    resources
      .filter((resource) =>
        resourceHasTag(
          resource.frontmatter,
          resource.tags ?? [],
          field.resourceTag!,
        ),
      )
      .map((resource) => ({
        name: resource.name,
        status: normalizeResourceStatus(resource.frontmatter?.status),
      })),
  );
}

export function getResourceNamesByFieldKey(
  fields: ActivityAttributeField[],
  resources: ActivityResourceMetadata[],
): Record<string, string[]> {
  return Object.fromEntries(
    fields
      .map(
        (field) =>
          [field.key, getResourceNamesForField(field, resources)] as const,
      )
      .filter(([, names]) => names.length),
  );
}
