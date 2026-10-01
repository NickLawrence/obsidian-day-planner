import { App, Modal, Notice } from "obsidian";

import type { ActivityAttributeField } from "../util/activity-definitions";

import { askForConfirmation } from "./confirmation-modal";

type ActivityAttributesModalProps = {
  title: string;
  fields: ActivityAttributeField[];
  initialValues?: Record<string, string | number | undefined>;
  fieldOptions?: Record<string, string[]>;
  onSubmit: (values: Record<string, string | number | undefined>) => void;
  onCancel: () => void;
};

class ActivityAttributesModal extends Modal {
  private settled = false;
  private confirmingDiscard = false;
  private readonly initialInputValues = new Map<string, string>();
  private readonly preventOutsideDismiss = (event: Event) => {
    if (event.target instanceof Node && !this.modalEl.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private readonly inputs = new Map<
    string,
    HTMLInputElement | HTMLTextAreaElement
  >();

  constructor(
    app: App,
    private readonly props: ActivityAttributesModalProps,
  ) {
    super(app);
    // Capture backdrop events before Obsidian's dismissal handlers receive them.
    for (const type of [
      "pointerdown",
      "mousedown",
      "mouseup",
      "click",
      "touchstart",
      "touchend",
    ]) {
      this.containerEl.addEventListener(type, this.preventOutsideDismiss, true);
    }
  }

  onOpen() {
    const { contentEl } = this;
    const { fields, title, initialValues, fieldOptions } = this.props;

    contentEl.empty();
    contentEl.addClass("day-planner-activity-attributes-modal");
    contentEl.createEl("h2", { text: title });

    const fieldsEl = contentEl.createDiv({
      cls: "day-planner-activity-attributes-modal__fields",
    });

    fields.forEach((field, index) => {
      const row = fieldsEl.createDiv({
        cls: "day-planner-activity-attributes-modal__row",
      });

      const inputId = `day-planner-activity-attribute-${index}`;
      const label = row.createEl("label", {
        text: field.label,
        cls: "day-planner-activity-attributes-modal__label",
        attr: { for: inputId },
      });

      if (field.required) {
        label.createSpan({
          text: " *",
          cls: "day-planner-activity-attributes-modal__required",
          attr: { "aria-hidden": "true" },
        });
      }

      const input =
        field.type === "textarea"
          ? row.createEl("textarea", {
              attr: { id: inputId, rows: "6", cols: "60" },
            })
          : row.createEl("input", {
              type: field.type === "number" ? "number" : "text",
              attr: { id: inputId },
            });

      input.name = field.key;
      input.required = field.required ?? false;
      input.addClass("day-planner-activity-attributes-modal__input");

      if (
        field.type === "text" &&
        input instanceof HTMLInputElement &&
        fieldOptions?.[field.key]?.length
      ) {
        const listId = `day-planner-activity-${field.key}-options`;
        const datalist = row.createEl("datalist");
        datalist.id = listId;
        fieldOptions[field.key].forEach((resourceName) => {
          datalist.createEl("option", { attr: { value: resourceName } });
        });
        input.setAttr("list", listId);
      }

      if (field.type === "number" && input instanceof HTMLInputElement) {
        if (typeof field.min === "number") {
          input.min = String(field.min);
        }
        if (typeof field.max === "number") {
          input.max = String(field.max);
        }
        input.step = "1";
      }

      const initialValue = initialValues?.[field.key];
      if (typeof initialValue !== "undefined") {
        input.value = String(initialValue);
      }

      this.inputs.set(field.key, input);
      this.initialInputValues.set(field.key, input.value);
    });

    const actions = contentEl.createDiv({
      cls: "day-planner-activity-attributes-modal__actions",
    });

    actions
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.cancel());
    actions
      .createEl("button", { text: "Save", cls: "mod-cta" })
      .addEventListener("click", () => this.submit());

    this.inputs.get(fields[0]?.key)?.focus();
  }

  onClose() {
    for (const type of [
      "pointerdown",
      "mousedown",
      "mouseup",
      "click",
      "touchstart",
      "touchend",
    ]) {
      this.containerEl.removeEventListener(
        type,
        this.preventOutsideDismiss,
        true,
      );
    }
    if (!this.settled) {
      this.settled = true;
      this.props.onCancel();
    }
    this.contentEl.empty();
  }

  close() {
    void this.cancel();
  }

  private async cancel() {
    if (this.settled || this.confirmingDiscard) return;
    const hasChanges = [...this.inputs].some(
      ([key, input]) => input.value !== this.initialInputValues.get(key),
    );
    if (hasChanges) {
      this.confirmingDiscard = true;
      try {
        const discard = await askForConfirmation({
          app: this.app,
          title: "Discard changes?",
          text: "Your unsaved activity details will be lost.",
          cta: "Discard changes",
        });
        if (!discard || this.settled) return;
      } finally {
        this.confirmingDiscard = false;
      }
    }
    super.close();
  }

  private submit() {
    if (this.settled || this.confirmingDiscard) return;
    const values: Record<string, string | number | undefined> = {};

    for (const field of this.props.fields) {
      const input = this.inputs.get(field.key);

      if (!input) {
        continue;
      }

      const rawValue = input.value.trim();

      if (!rawValue) {
        if (field.required) {
          new Notice(`${field.label} is required.`);
          return;
        }

        values[field.key] = undefined;
        continue;
      }

      if (field.type === "number") {
        const parsed = Number(rawValue);

        if (Number.isNaN(parsed)) {
          new Notice(`${field.label} must be a number.`);
          return;
        }

        if (typeof field.min === "number" && parsed < field.min) {
          new Notice(`${field.label} must be at least ${field.min}.`);
          return;
        }

        if (typeof field.max === "number" && parsed > field.max) {
          new Notice(`${field.label} must be at most ${field.max}.`);
          return;
        }

        values[field.key] = parsed;
        continue;
      }

      values[field.key] = rawValue;
    }

    this.settled = true;
    this.props.onSubmit(values);
    super.close();
  }
}

export function askForActivityAttributes(
  app: App,
  props: {
    title: string;
    fields: ActivityAttributeField[];
    initialValues?: Record<string, string | number | undefined>;
    fieldOptions?: Record<string, string[]>;
  },
): Promise<Record<string, string | number | undefined> | undefined> {
  return new Promise((resolve) => {
    new ActivityAttributesModal(app, {
      ...props,
      onSubmit: (values) => resolve(values),
      onCancel: () => resolve(undefined),
    }).open();
  });
}
