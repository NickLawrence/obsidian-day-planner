import { describe, expect, it } from "vitest";

import type { ActivityAttributeField } from "../src/util/activity-definitions";
import {
  getActivityResourcePath,
  getAvailableResourceNamesForField,
} from "../src/util/activity-resources";

function getFileName(path: string) {
  return path.split("/").at(-1);
}

function getBasename(path: string) {
  return getFileName(path)?.replace(/\.md$/i, "");
}

function createApp(files: Array<{ path: string; metadata: unknown }>) {
  const markdownFiles = files.map(({ path }) => ({
    path,
    name: getFileName(path),
    basename: getBasename(path),
  }));

  return {
    vault: {
      getMarkdownFiles: () => markdownFiles,
    },
    metadataCache: {
      getFileCache: (file: { path: string }) =>
        files.find(({ path }) => path === file.path)?.metadata,
      getFirstLinkpathDest: (linkpath: string) =>
        markdownFiles.find(
          (file) => file.basename === linkpath || file.name === linkpath,
        ),
    },
  };
}

const bookField: ActivityAttributeField = {
  key: "book",
  label: "Book",
  type: "text",
  resourceTag: "book",
};

describe("getAvailableResourceNamesForField", () => {
  it("returns resource names matching the configured resource tag", () => {
    const app = createApp([
      {
        path: "Books/The Hobbit.md",
        metadata: { frontmatter: { tags: ["book"], status: "Backlog" } },
      },
      {
        path: "Books/Dune.md",
        metadata: {
          tags: [{ tag: "#book" }],
          frontmatter: { status: "In Progress" },
        },
      },
      {
        path: "Movies/Dune.md",
        metadata: { frontmatter: { tags: ["movie"], status: "Backlog" } },
      },
    ]);

    expect(getAvailableResourceNamesForField(app as never, bookField)).toEqual([
      "Dune",
      "The Hobbit",
    ]);
  });

  it("does not return completed resource files", () => {
    const app = createApp([
      {
        path: "Books/Done Book.md",
        metadata: { frontmatter: { tags: ["book"], status: "Complete" } },
      },
      {
        path: "Books/Available Book.md",
        metadata: { frontmatter: { tag: "#book", status: "Backlog" } },
      },
    ]);

    expect(getAvailableResourceNamesForField(app as never, bookField)).toEqual([
      "Available Book",
    ]);
  });

  it("returns no resource names when the field has no resource tag", () => {
    expect(
      getAvailableResourceNamesForField(createApp([]) as never, {
        key: "name",
        label: "Name",
        type: "text",
      }),
    ).toEqual([]);
  });
});

describe("getActivityResourcePath", () => {
  it("returns the matching resource path for an activity entry", () => {
    const app = createApp([
      {
        path: "Books/Dune.md",
        metadata: { frontmatter: { tags: ["book"], status: "Complete" } },
      },
    ]);

    expect(
      getActivityResourcePath({
        metadataCache: app.metadataCache as never,
        activityName: "read",
        activityEntry: { activity: "read", read: { book: "Dune" } },
        sourcePath: "Daily/2026-05-15.md",
      }),
    ).toBe("Books/Dune.md");
  });

  it("does not return a linked file with the wrong resource tag", () => {
    const app = createApp([
      {
        path: "Movies/Dune.md",
        metadata: { frontmatter: { tags: ["movie"], status: "Backlog" } },
      },
    ]);

    expect(
      getActivityResourcePath({
        metadataCache: app.metadataCache as never,
        activityName: "read",
        activityEntry: { activity: "read", read: { book: "Dune" } },
        sourcePath: "Daily/2026-05-15.md",
      }),
    ).toBeUndefined();
  });
});
