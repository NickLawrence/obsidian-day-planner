import { Menu } from "obsidian";
import { isNotVoid } from "typed-assert";

import type { LocalTask } from "../task-types";
import type { Activity } from "../util/props";

import type { WorkspaceFacade } from "src/service/workspace-facade";
import type { STaskEditor } from "../service/stask-editor";

export function createTimeBlockMenu(props: {
  event: MouseEvent | TouchEvent;
  task: LocalTask & { clockActivity?: Activity };
  workspaceFacade: WorkspaceFacade;
  sTaskEditor: STaskEditor;
}) {
  const { event, task, workspaceFacade, sTaskEditor } = props;
  const { location } = task;

  // todo: remove when types are fixed
  isNotVoid(location);

  const {
    path,
    position: {
      start: { line },
    },
  } = location;

  const menu = new Menu();
  const isActivity = Boolean(task.clockActivity);
  const isCompletedActivity = Boolean(task.clockActivity?.log?.[0]?.end);
  const isActiveActivity = isActivity && !isCompletedActivity;

  if (isActiveActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Clock out")
        .setIcon("square")
        .onClick(async () => {
          await sTaskEditor.clockOutTask(task);
        });
    });
  }

  if (isActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Add note to activity")
        .setIcon("sticky-note")
        .onClick(async () => {
          await sTaskEditor.addNoteToClockActivity(task);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Change start time")
        .setIcon("clock")
        .onClick(async () => {
          await sTaskEditor.changeClockActivityStartTime(task);
        });
    });
  }

  if (isCompletedActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Change end time")
        .setIcon("clock-3")
        .onClick(async () => {
          await sTaskEditor.changeClockActivityEndTime(task);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Change rating")
        .setIcon("star")
        .onClick(async () => {
          await sTaskEditor.changeClockActivityRating(task);
        });
    });
  }

  if (isActiveActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Cancel clock")
        .setIcon("trash-2")
        .onClick(async () => {
          await sTaskEditor.cancelClockForTask(task);
        });
    });
  }

  if (!isActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Add to current activity")
        .setIcon("plus")
        .onClick(async () => {
          await sTaskEditor.addTaskToCurrentActivity(task);
        });
    });
  }

  menu.addItem((item) => {
    item
      .setTitle("Reveal task in file")
      .setIcon("file-input")
      .onClick(async () => {
        await workspaceFacade.revealLineInFile(path, line);
      });
  });

  // Obsidian works fine with touch events, but its TypeScript definitions don't reflect that.
  // @ts-expect-error
  menu.showAtMouseEvent(event);
}
