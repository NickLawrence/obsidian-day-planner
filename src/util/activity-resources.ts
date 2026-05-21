import type { App, CachedMetadata, MetadataCache, TFile } from "obsidian";

import {
  type ActivityAttributeField,
  getActivityAttributeFields,
  getActivityAttributeValues,
} from "./activity-definitions";

const completeStatus = "complete";

function normalizeTag(tag: string) {
  return tag.replace(/^#/, "").trim().toLowerCase();
}

function normalizeStatus(status: unknown) {
  return typeof status === "string" ? status.trim().toLowerCase() : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function frontmatterHasTag(
  frontmatter: CachedMetadata["frontmatter"],
  tag: string,
) {
  if (!frontmatter) {
    return false;
  }

  const normalizedTag = normalizeTag(tag);
  const frontmatterTags = frontmatter.tags ?? frontmatter.tag;

  return asArray(frontmatterTags).some(
    (frontmatterTag) =>
      typeof frontmatterTag === "string" &&
      normalizeTag(frontmatterTag) === normalizedTag,
  );
}

function metadataHasTag(
  metadata: CachedMetadata | null | undefined,
  tag: string,
) {
  if (!metadata) {
    return false;
  }

  const normalizedTag = normalizeTag(tag);

  return (
    metadata.tags?.some(({ tag: metadataTag }) => {
      return normalizeTag(metadataTag) === normalizedTag;
    }) ?? false
  );
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

  return app.vault
    .getMarkdownFiles()
    .map((file) => {
      const metadata = app.metadataCache.getFileCache(file);

      return {
        file,
        name: getFileDisplayName(file),
        status: normalizeStatus(metadata?.frontmatter?.status),
        hasResourceTag:
          frontmatterHasTag(metadata?.frontmatter, resourceTag) ||
          metadataHasTag(metadata, resourceTag),
      };
    })
    .filter(({ hasResourceTag }) => hasResourceTag);
}

export function getAvailableResourceNamesForField(
  app: App,
  field: ActivityAttributeField,
) {
  const { resourceTag } = field;

  if (!resourceTag) {
    return [];
  }

  const uniqueResourceNames = new Set<string>();

  return getResourceFilesForField(app, field)
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

export function getAvailableResourceNamesByFieldKey(
  app: App,
  fields: ActivityAttributeField[],
): Record<string, string[]> {
  return Object.fromEntries(
    fields
      .map((field) => [
        field.key,
        getAvailableResourceNamesForField(app, field),
      ])
      .filter(([, resourceNames]) => resourceNames.length > 0),
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
      (frontmatterHasTag(metadata?.frontmatter, field.resourceTag) ||
        metadataHasTag(metadata, field.resourceTag))
    ) {
      return file.path;
    }
  }

  return undefined;
}
