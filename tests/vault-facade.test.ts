import { describe, expect, test, vi } from "vitest";
import type { TFile, Vault } from "obsidian";

import { VaultFacade } from "../src/service/vault-facade";
import { createInMemoryFile } from "./test-utils";

describe("VaultFacade", () => {
  test("does not modify a file when an edit returns identical contents", async () => {
    const file = createInMemoryFile({
      path: "Daily/2026-07-06.md",
      contents: "same",
    });
    const vault = {
      getAbstractFileByPath: vi.fn(() => file),
      read: vi.fn(async () => file.contents),
      modify: vi.fn(async (_file: TFile, contents: string) => {
        file.contents = contents;
      }),
    } as unknown as Vault;
    const facade = new VaultFacade(vault, () => undefined);

    await facade.editFile(file.path, (contents) => contents);

    expect(vault.modify).not.toHaveBeenCalled();
  });
});
