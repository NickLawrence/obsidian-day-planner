import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivityNotificationsWeb,
  ActivityNotifications,
  vaultFiles,
} from "../src/lib/activity-notifications";

const nativeListFiles = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, registerPlugin: () => ({ listFiles: nativeListFiles }) };
});

interface MockDirectory {
  kind: "directory";
  name: string;
  entries: ReturnType<typeof vi.fn>;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
}

function directory(
  name: string,
  children: Record<string, MockDirectory | { kind: "file" }> = {},
): MockDirectory {
  return {
    kind: "directory" as const,
    name,
    entries: vi.fn(async function* () {
      for (const child of Object.entries(children)) yield child;
    }),
    getDirectoryHandle: vi.fn(async (name: string) => {
      const child = children[name];
      if (!child) throw new DOMException("Missing", "NotFoundError");
      if (child.kind !== "directory")
        throw new DOMException("Not a directory", "TypeMismatchError");
      return child;
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scoped vault enumeration", () => {
  it("history requests only activity YAML files from the native bridge", async () => {
    const list = vi
      .spyOn(ActivityNotifications, "listFiles")
      .mockResolvedValue({ paths: ["_Planner/activities/2026/2026-W41.yaml"] });
    expect(await vaultFiles.listFiles()).toEqual([
      "_Planner/activities/2026/2026-W41.yaml",
    ]);
    expect(list).toHaveBeenCalledWith({
      folder: "_Planner/activities",
      extension: ".yaml",
    });
  });

  it("visits the requested subtree without enumerating unrelated notes or attachments", async () => {
    const year = directory("2026", {
      "2026-W41.yaml": { kind: "file" },
      "Ignored.md": { kind: "file" },
    });
    const activities = directory("activities", { "2026": year });
    const notes = directory("Notes", { "note.md": { kind: "file" } });
    const root = directory("Vault", {
      _Planner: directory("_Planner", { activities }),
      Notes: notes,
    });
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(root));
    const bridge = new ActivityNotificationsWeb();
    await bridge.chooseVault();
    expect(
      await bridge.listFiles({
        folder: "_Planner/activities",
        extension: ".yaml",
      }),
    ).toEqual({ paths: ["_Planner/activities/2026/2026-W41.yaml"] });
    expect(root.entries).not.toHaveBeenCalled();
    expect(notes.entries).not.toHaveBeenCalled();
  });

  it("returns an empty history for a new vault without _Planner and rejects traversal", async () => {
    vi.stubGlobal(
      "showDirectoryPicker",
      vi.fn().mockResolvedValue(directory("Vault")),
    );
    const bridge = new ActivityNotificationsWeb();
    await bridge.chooseVault();
    expect(
      await bridge.listFiles({
        folder: "_Planner/activities",
        extension: ".yaml",
      }),
    ).toEqual({ paths: [] });
    await expect(
      bridge.listFiles({ folder: "../Other", extension: ".yaml" }),
    ).rejects.toThrow("Invalid vault path");
  });
});
