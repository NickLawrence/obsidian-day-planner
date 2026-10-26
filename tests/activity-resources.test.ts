import { describe, expect, it } from "vitest";

import type { ActivityAttributeField } from "../src/util/activity-definitions";
import {
  getActivityFieldOptions,
  getActivityStartSuggestions,
  getActivityResourcePath,
  getResourceCover,
  getAvailableResourceNamesForField,
  getResourceFilesForField,
} from "../src/util/activity-resources";
import type { Activity } from "../src/util/props";

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

describe("getActivityStartSuggestions", () => {
  function history(activity: string, values: Record<string, string>): Activity {
    return { activity, taskIds: [], log: [], [activity]: values };
  }

  it("hides completed files and aliases only in the main picker, keeping activity types and field history", () => {
    const app = createApp([
      {
        path: "Books/Finished Book.md",
        metadata: {
          frontmatter: {
            tags: ["book"],
            aliases: ["Finished Alias"],
            status: " Complete ",
          },
        },
      },
      {
        path: "Games/Finished Game.md",
        metadata: {
          frontmatter: {
            tag: "#game",
            alias: "Done Game Alias",
            status: "COMPLETED",
          },
        },
      },
      {
        path: "Books/Current Book.md",
        metadata: { frontmatter: { tags: ["book"], status: "In Progress" } },
      },
    ]);
    const activities = [
      history("read", { book: "Finished Book" }),
      history("read", { book: " finished ALIAS " }),
      history("read", { book: "Current Book" }),
      history("game", { name: "Done Game Alias" }),
    ];
    const suggestions = getActivityStartSuggestions(app as never, activities);
    expect(
      suggestions
        .filter(({ activityName }) => activityName === "read")
        .map(({ text }) => text),
    ).toEqual(["read", "read - Current Book"]);
    expect(
      suggestions
        .filter(({ activityName }) => activityName === "game")
        .map(({ text }) => text),
    ).toEqual(["game"]);
    expect(
      getActivityFieldOptions(app as never, "read", [bookField], activities)
        .book,
    ).toEqual(
      expect.arrayContaining([
        "Finished Book",
        "finished ALIAS",
        "Current Book",
      ]),
    );
  });

  it("preserves unlinked history, unfinished resources, and values associated with a different file type", () => {
    const app = createApp([
      {
        path: "Books/Dune.md",
        metadata: { frontmatter: { tags: ["book"], status: "Complete" } },
      },
      {
        path: "Games/Portal.md",
        metadata: { frontmatter: { tags: ["game"], status: "Backlog" } },
      },
      {
        path: "Books/Unknown Status.md",
        metadata: { tags: [{ tag: "#book" }] },
      },
    ]);
    const suggestions = getActivityStartSuggestions(app as never, [
      history("read", { book: "Unknown Status" }),
      history("read", { book: "Unlinked Book" }),
      history("game", { name: "Dune" }),
      history("game", { name: "Portal" }),
      history("tv", { name: "Dune" }),
    ]);
    expect(suggestions.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        "read - Unknown Status",
        "read - Unlinked Book",
        "game - Dune",
        "game - Portal",
        "tv - Dune",
      ]),
    );
  });

  it("fills the suggestion limit from unfinished history after excluding completed files", () => {
    const app = createApp([
      {
        path: "Books/Finished Book.md",
        metadata: { frontmatter: { tags: ["book"], status: "Complete" } },
      },
    ]);
    const activities = [
      ...Array.from({ length: 6 }, (_, index) =>
        history("read", { book: `Book ${index}` }),
      ),
      history("read", { book: "Finished Book" }),
    ];
    const suggestions = getActivityStartSuggestions(app as never, activities);
    expect(
      suggestions
        .filter(
          ({ activityName, initialValues }) =>
            activityName === "read" && initialValues,
        )
        .map(({ initialValues }) => initialValues?.book),
    ).toEqual(["Book 5", "Book 4", "Book 3", "Book 2", "Book 1"]);
  });

  it("uses current file status each time the picker opens", () => {
    const frontmatter = { tags: ["book"], status: "Complete" };
    const app = createApp([
      { path: "Books/Dune.md", metadata: { frontmatter } },
    ]);
    const activities = [history("read", { book: "Dune" })];
    expect(
      getActivityStartSuggestions(app as never, activities).some(
        ({ text }) => text === "read - Dune",
      ),
    ).toBe(false);
    frontmatter.status = "In Progress";
    expect(
      getActivityStartSuggestions(app as never, activities).some(
        ({ text }) => text === "read - Dune",
      ),
    ).toBe(true);
  });
});

describe("getAvailableResourceNamesForField", () => {
  it("includes resource file aliases from frontmatter", () => {
    const app = createApp([
      {
        path: "Books/The Hobbit.md",
        metadata: {
          frontmatter: {
            aliases: ["There and Back Again"],
            tags: ["book"],
            status: "Backlog",
          },
        },
      },
      {
        path: "Books/Dune.md",
        metadata: {
          frontmatter: {
            alias: "Dune Book One",
            tags: ["book"],
            status: "Backlog",
          },
        },
      },
    ]);

    expect(getResourceFilesForField(app as never, bookField)).toMatchObject([
      { name: "The Hobbit", aliases: ["There and Back Again"] },
      { name: "Dune", aliases: ["Dune Book One"] },
    ]);
  });

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

describe("getActivityFieldOptions", () => {
  it("combines resource files with previous main-key values", () => {
    const app = createApp([
      {
        path: "Books/Dune.md",
        metadata: { frontmatter: { tags: ["book"], status: "Backlog" } },
      },
    ]);
    const activities = [
      { activity: "read", taskIds: [], log: [], read: { book: "Dune" } },
      { activity: "read", taskIds: [], log: [], read: { book: "The Hobbit" } },
    ];

    expect(
      getActivityFieldOptions(app as never, "read", [bookField], activities),
    ).toEqual({ book: ["Dune", "The Hobbit"] });
  });

  it("adds previous main-key values when there are no resource files", () => {
    const nameField: ActivityAttributeField = {
      key: "name",
      label: "Show",
      type: "text",
    };
    const activities = [
      { activity: "tv", taskIds: [], log: [], tv: { name: "Severance" } },
    ];

    expect(
      getActivityFieldOptions(
        createApp([]) as never,
        "tv",
        [nameField],
        activities,
      ),
    ).toEqual({ name: ["Severance"] });
  });
});

describe("getResourceCover", () => {
  it.each([
    "Images/cover.png",
    "[[Images/cover.png]]",
    "![[Images/cover.png|200]]",
    "![Cover](Images/cover.png)",
  ])("resolves %s relative to the resource page", (cover) => {
    const file = { path: "Books/Dune.md" };
    let resolvedSource = "";
    const app = {
      metadataCache: {
        getFileCache: () => ({ frontmatter: { cover } }),
        getFirstLinkpathDest: (link: string, source: string) => {
          resolvedSource = source;
          return link === "Images/cover.png"
            ? { path: "Images/cover.png" }
            : null;
        },
      },
      vault: {
        getResourcePath: (image: { path: string }) =>
          `app://vault/${image.path}`,
      },
    };
    expect(getResourceCover(app as never, file as never)).toBe(
      "app://vault/Images/cover.png",
    );
    expect(resolvedSource).toBe(file.path);
  });

  it.each([undefined, "", 123, ["cover.png"], "missing.png"])(
    "ignores absent, invalid or missing covers: %s",
    (cover) => {
      const app = {
        metadataCache: {
          getFileCache: () => ({ frontmatter: { cover } }),
          getFirstLinkpathDest: () => null,
        },
      };
      expect(getResourceCover(app as never, {} as never)).toBeUndefined();
    },
  );

  it.each([
    "https://example.com/cover.png",
    "![Cover](https://example.com/cover.png)",
  ])("supports an external image: %s", (cover) => {
    const app = {
      metadataCache: { getFileCache: () => ({ frontmatter: { cover } }) },
    };
    expect(getResourceCover(app as never, {} as never)).toBe(
      "https://example.com/cover.png",
    );
  });
});
