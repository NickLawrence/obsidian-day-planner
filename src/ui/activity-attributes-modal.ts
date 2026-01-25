import { App, Modal, Notice } from "obsidian";

import type { ActivityAttributeField } from "../util/activity-definitions";

type ActivityAttributesModalProps = {
  title: string;
  fields: ActivityAttributeField[];
  initialValues?: Record<string, string | number | undefined>;
  onSubmit: (values: Record<string, string | number | undefined>) => void;
  onCancel: () => void;
};

class ActivityAttributesModal extends Modal {
  private readonly inputs = new Map<string, HTMLInputElement>();

  constructor(
    app: App,
    private readonly props: ActivityAttributesModalProps,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const { fields, title, initialValues } = this.props;

    contentEl.empty();
    contentEl.addClass("day-planner-activity-attributes-modal");
    contentEl.createEl("h2", { text: title });

    fields.forEach((field) => {
      const row = contentEl.createDiv({
        cls: "day-planner-activity-attributes-modal__row",
      });

      row.createEl("label", {
        text: field.label,
        cls: "day-planner-activity-attributes-modal__label",
      });

      const input = row.createEl("input", {
        type: field.type === "number" ? "number" : "text",
      });

      if (field.type === "number") {
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
    });

    const actions = contentEl.createDiv({
      cls: "day-planner-activity-attributes-modal__actions",
    });

    actions
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.cancel());
    actions
      .createEl("button", { text: "Save" })
      .addEventListener("click", () => this.submit());
  }

  onClose() {
    this.contentEl.empty();
  }

  private cancel() {
    this.props.onCancel();
    this.close();
  }

  private submit() {
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

    this.props.onSubmit(values);
    this.close();
  }
}

export function askForActivityAttributes(
  app: App,
  props: {
    title: string;
    fields: ActivityAttributeField[];
    initialValues?: Record<string, string | number | undefined>;
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
