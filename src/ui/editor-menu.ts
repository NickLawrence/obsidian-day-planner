import type { Editor, Menu } from "obsidian";

import type DayPlanner from "../main";
import type { STaskEditor } from "../service/stask-editor";

export const createEditorMenuCallback =
  (props: { sTaskEditor: STaskEditor; plugin: DayPlanner }) =>
  (menu: Menu, editor: Editor) => {
    const { sTaskEditor } = props;

    let sTask;

    try {
      ({ sTask } = sTaskEditor.getSTaskUnderCursorFromLastView());
    } catch {
      return;
    }

    menu.addSeparator();

    const hasOpenClock = sTaskEditor.hasOpenClockForTask(sTask);

    if (hasOpenClock) {
      menu.addItem((item) => {
        item
          .setTitle("Clock out")
          .setIcon("square")
          .onClick(() => sTaskEditor.clockOutUnderCursor());
      });

      menu.addItem((item) => {
        item
          .setTitle("Cancel clock")
          .setIcon("trash")
          .onClick(() => sTaskEditor.cancelClockUnderCursor());
      });
    } else {
      menu.addItem((item) => {
        item
          .setTitle("Clock in")
          .setIcon("play")
          .onClick(() => sTaskEditor.clockInUnderCursor());
      });
    }
  };
