import { App, SuggestModal } from "obsidian";

type Suggestion = { text: string; displayText?: string };

export class SingleSuggestModal extends SuggestModal<Suggestion> {
  constructor(
    private readonly props: {
      app: App;
      getDescriptionText: (input: string) => string;
      getSuggestions?: (input: string) => Suggestion[];
      onChooseSuggestion: (suggestion: Suggestion) => void;
      onClose: () => void;
    },
  ) {
    super(props.app);

    this.setInstructions([
      { command: "esc", purpose: "to dismiss" },
      { command: "↵", purpose: "to confirm" },
    ]);
  }

  getSuggestions(query: string) {
    if (this.props.getSuggestions) {
      return this.props.getSuggestions(query);
    }

    return [{ text: query }];
  }

  renderSuggestion(item: Suggestion, el: HTMLElement) {
    const displayText =
      item.displayText ?? this.props.getDescriptionText(item.text);

    el.createDiv({ text: displayText });
  }

  onChooseSuggestion(item: Suggestion, evt: MouseEvent | KeyboardEvent) {
    this.props.onChooseSuggestion(item);
  }

  close() {
    // Note: we need to be able to run onChooseSuggestion before onClose
    window.setTimeout(() => {
      this.props.onClose();
      super.close();
    });
  }
}
