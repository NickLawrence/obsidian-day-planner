import { App, Modal } from "obsidian";

export interface ConfirmationModalProps {
  cta: string;
  text: string;
  title: string;
}

class ConfirmationModal extends Modal {
  constructor(
    app: App,
    private readonly props: ConfirmationModalProps & {
      onAccept: (event: MouseEvent) => Promise<void>;
      onCancel: () => void;
    },
  ) {
    super(app);

    const { cta, onAccept, text, title } = props;

    this.contentEl.createEl("h2", { text: title });
    this.contentEl.createEl("p", { text });

    this.contentEl.createDiv("day-planner-modal-buttons", (buttonsEl) => {
      buttonsEl
        .createEl("button", { text: "Cancel" })
        .addEventListener("click", () => {
          this.close();
        });

      buttonsEl
        .createEl("button", {
          cls: "mod-cta",
          text: cta,
        })
        .addEventListener("click", async (e) => {
          await onAccept(e);

          this.close();
        });
    });
  }

  onClose() {
    // Escape and backdrop dismissal must also resolve the pending question.
    // Resolving false after an accepted confirmation has no effect.
    this.props.onCancel();
  }
}

export async function askForConfirmation(
  props: {
    app: App;
  } & ConfirmationModalProps,
): Promise<boolean> {
  return new Promise((resolve) => {
    const { app, ...rest } = props;

    new ConfirmationModal(app, {
      ...rest,
      onAccept: async () => resolve(true),
      onCancel: () => resolve(false),
    }).open();
  });
}
