import type { App, CachedMetadata, MetadataCache, TFile } from "obsidian";

import {
  type ActivityAttributeField,
  getActivityAttributeFields,
  getActivityAttributeValues,
} from "./activity-definitions";
import {
  getAvailableResourceNames,
  mergeActivityFieldOptions,
  normalizeResourceStatus,
  resourceHasTag,
  getResourceAliases,
  getResourceNamesByFieldKey,
} from "./activity-field-options";
import type { Activity } from "./activity-schema";
export {
  getAvailableResourceNames,
  mergeActivityFieldOptions,
  resourceHasTag,
} from "./activity-field-options";

function metadataResourceHasTag(
  metadata: CachedMetadata | null | undefined,
  tag: string,
) {
  return resourceHasTag(
    metadata?.frontmatter,
    metadata?.tags?.map(({ tag }) => tag) ?? [],
    tag,
  );
}

function getResourceMetadata(app: App) {
  return app.vault.getMarkdownFiles().map((file) => {
    const metadata = app.metadataCache.getFileCache(file);
    return {
      file,
      name: getFileDisplayName(file),
      aliases: getResourceAliases(metadata?.frontmatter),
      frontmatter: metadata?.frontmatter ?? {},
      tags: metadata?.tags?.map(({ tag }) => tag) ?? [],
      status: normalizeResourceStatus(metadata?.frontmatter?.status),
    };
  });
}

function getFileDisplayName(file: TFile) {
  return file.basename ?? file.name?.replace(/\.md$/i, "") ?? file.path;
}

export function getResourceFilesForField(
  app: App,
  field: ActivityAttributeField,
) {
  const { resourceTag } = field;

  if (!resourceTag) {
    return [];
  }

  return getResourceMetadata(app)
    .filter((resource) =>
      resourceHasTag(resource.frontmatter, resource.tags, resourceTag),
    )
    .map((resource) => ({ ...resource, hasResourceTag: true }));
}

export function getAvailableResourceNamesForField(
  app: App,
  field: ActivityAttributeField,
) {
  const { resourceTag } = field;

  if (!resourceTag) {
    return [];
  }

  return getAvailableResourceNames(getResourceFilesForField(app, field));
}

export function getAvailableResourceNamesByFieldKey(
  app: App,
  fields: ActivityAttributeField[],
): Record<string, string[]> {
  return getResourceNamesByFieldKey(fields, getResourceMetadata(app));
}

export function getActivityFieldOptions(
  app: App,
  activityName: string,
  fields: ActivityAttributeField[],
  activities: Activity[],
): Record<string, string[]> {
  return mergeActivityFieldOptions(
    activityName,
    activities,
    getAvailableResourceNamesByFieldKey(app, fields),
  );
}

export function getActivityResourcePath(props: {
  metadataCache: MetadataCache;
  activityName: string;
  activityEntry: Record<string, unknown>;
  sourcePath: string;
}) {
  const { metadataCache, activityName, activityEntry, sourcePath } = props;
  const values = getActivityAttributeValues(activityName, activityEntry);
  const resourceFields = getActivityAttributeFields(
    activityName,
    "start",
  ).filter((field) => field.resourceTag);

  for (const field of resourceFields) {
    const value = values[field.key];

    if (typeof value !== "string" && typeof value !== "number") {
      continue;
    }

    const resourceName = String(value).trim();

    if (!resourceName) {
      continue;
    }

    const file = metadataCache.getFirstLinkpathDest(resourceName, sourcePath);

    if (!file) {
      continue;
    }

    const metadata = metadataCache.getFileCache(file);

    if (
      field.resourceTag &&
      metadataResourceHasTag(metadata, field.resourceTag)
    ) {
      return file.path;
    }
  }

  return undefined;
}
