import { App, Modal, Notice } from "obsidian";

import {
  type ActivityAttributeField,
  getInitialActivityValues,
  hasActivityFormChanges,
  parseActivityValues,
} from "../shared/activity";

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

    const initialInputs = getInitialActivityValues(fields, initialValues);

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

      input.value = initialInputs[field.key];

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
    const hasChanges = hasActivityFormChanges(
      Object.fromEntries(this.initialInputValues),
      Object.fromEntries(
        [...this.inputs].map(([key, input]) => [key, input.value]),
      ),
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
    let values: Record<string, string | number | undefined>;
    try {
      values = parseActivityValues(
        this.props.fields,
        Object.fromEntries(
          [...this.inputs].map(([key, input]) => [key, input.value]),
        ),
      );
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Invalid activity details",
      );
      return;
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
