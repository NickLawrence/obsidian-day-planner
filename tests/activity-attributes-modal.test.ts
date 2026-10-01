import type { App, Modal } from "obsidian";
import { afterEach, describe, expect, test, vi } from "vitest";

import { askForActivityAttributes } from "../src/ui/activity-attributes-modal";

const { modals } = vi.hoisted(() => ({ modals: [] as Modal[] }));

vi.mock("obsidian", () => {
  function decorate(element: HTMLElement): HTMLElement {
    return Object.assign(element, {
      empty: () => element.replaceChildren(),
      addClass: (cls: string) => element.classList.add(cls),
      setAttr: (key: string, value: string) => element.setAttribute(key, value),
      createEl: (
        tag: string,
        options: {
          text?: string;
          cls?: string;
          type?: string;
          attr?: Record<string, string>;
        } = {},
      ) => {
        const child = decorate(document.createElement(tag));
        if (options.text) child.textContent = options.text;
        if (options.cls) child.className = options.cls;
        if (options.type) child.setAttribute("type", options.type);
        for (const [key, value] of Object.entries(options.attr ?? {}))
          child.setAttribute(key, value);
        element.appendChild(child);
        return child;
      },
      createDiv: (
        options: string | { cls?: string } = {},
        callback?: (el: HTMLElement) => void,
      ) => {
        const child = decorate(document.createElement("div"));
        child.className =
          typeof options === "string" ? options : (options.cls ?? "");
        element.appendChild(child);
        callback?.(child);
        return child;
      },
    });
  }
  return {
    Notice: vi.fn(),
    Modal: class {
      containerEl = decorate(document.createElement("div"));
      modalEl = this.containerEl.createDiv();
      contentEl = this.modalEl.createDiv();
      constructor(public app: App) {
        this.containerEl.addEventListener("click", (event) => {
          if (!this.modalEl.contains(event.target as Node)) this.close();
        });
        modals.push(this as unknown as Modal);
      }
      open() {
        document.body.appendChild(this.containerEl);
        this.onOpen();
      }
      close() {
        this.onClose();
        this.containerEl.remove();
      }
      onOpen() {}
      onClose() {}
    },
  };
});

afterEach(() => {
  document.body.replaceChildren();
  modals.length = 0;
});

function open(initialValues?: Record<string, string>) {
  const result = askForActivityAttributes({} as App, {
    title: "Activity",
    fields: [{ key: "notes", label: "Notes", type: "textarea" }],
    initialValues,
  });
  const modal = modals[0];
  const input = modal.contentEl.querySelector("textarea")!;
  return { result, modal, input };
}

function click(modal: Modal, label: string) {
  const button = Array.from(modal.contentEl.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  )!;
  button.click();
}

describe("activity draft protection", () => {
  test("ignores outside clicks with and without input", () => {
    const { modal, input } = open();
    modal.containerEl.click();
    expect(modal.containerEl.isConnected).toBe(true);
    input.value = "My draft";
    modal.containerEl.click();
    expect(input.value).toBe("My draft");
    expect(modals).toHaveLength(1);
  });

  test("canceling an untouched prefilled form needs no confirmation", async () => {
    const { modal, result } = open({ notes: "Existing notes" });
    click(modal, "Cancel");
    await expect(result).resolves.toBeUndefined();
    expect(modals).toHaveLength(1);
    expect(modal.containerEl.isConnected).toBe(false);
  });

  test.each(["cancel", "close"])(
    "protects drafts on %s and preserves them when confirmation is dismissed",
    async (method) => {
      const { modal, input, result } = open();
      input.value = "Keep my notes";
      if (method === "cancel") click(modal, "Cancel");
      else modal.close();
      modal.close();
      expect(modals).toHaveLength(2);
      expect(modal.containerEl.isConnected).toBe(true);
      if (method === "cancel") click(modals[1], "Cancel");
      else modals[1].close();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(input.value).toBe("Keep my notes");
      expect(modal.containerEl.isConnected).toBe(true);
      click(modal, "Save");
      await expect(result).resolves.toEqual({ notes: "Keep my notes" });
      expect(modals).toHaveLength(2);
    },
  );

  test("explicit discard closes the form and resolves cancellation", async () => {
    const { modal, input, result } = open({ notes: "Existing notes" });
    input.value = "";
    click(modal, "Cancel");
    click(modals[1], "Discard changes");
    await expect(result).resolves.toBeUndefined();
    expect(modal.containerEl.isConnected).toBe(false);
  });
});
