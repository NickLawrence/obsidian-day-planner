import { Menu } from "obsidian";
import { isNotVoid } from "typed-assert";

import type { ActivityEditor } from "../service/activity-editor";
import type { LocalTask } from "../task-types";
import { getActivityLabel } from "../util/activity-definitions";
import type { Activity } from "../util/props";

import type { WorkspaceFacade } from "src/service/workspace-facade";

export function createTimeBlockMenu(props: {
  event: MouseEvent | TouchEvent;
  task: LocalTask & { clockActivity?: Activity };
  workspaceFacade: WorkspaceFacade;
  activityEditor: ActivityEditor;
}) {
  const { event, task, workspaceFacade, activityEditor } = props;
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

  const activity = task.clockActivity;
  if (activity) {
    menu.addItem((item) => {
      item.setTitle(getActivityLabel(activity.activity)).setDisabled(true);
    });
    menu.addSeparator();
  }

  if (isActiveActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Clock out")
        .setIcon("square")
        .onClick(async () => {
          await activityEditor.finishActivity(task);
        });
    });
  }

  if (isActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Add note to activity")
        .setIcon("sticky-note")
        .onClick(async () => {
          await activityEditor.addNoteToClockActivity(task);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Change start time")
        .setIcon("clock")
        .onClick(async () => {
          await activityEditor.changeClockActivityStartTime(task);
        });
    });
  }

  if (isCompletedActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Change end time")
        .setIcon("clock-3")
        .onClick(async () => {
          await activityEditor.changeClockActivityEndTime(task);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Change rating")
        .setIcon("star")
        .onClick(async () => {
          await activityEditor.changeClockActivityRating(task);
        });
    });
  }

  if (isActiveActivity) {
    menu.addItem((item) => {
      item
        .setTitle("Cancel clock")
        .setIcon("trash-2")
        .onClick(async () => {
          await activityEditor.cancelActivity(task);
        });
    });
  }

  menu.addItem((item) => {
    item
      .setTitle(isActivity ? "Reveal activity file" : "Reveal task in file")
      .setIcon("file-input")
      .onClick(async () => {
        await workspaceFacade.revealLineInFile(path, line);
      });
  });

  // Obsidian works fine with touch events, but its TypeScript definitions don't reflect that.
  // @ts-expect-error
  menu.showAtMouseEvent(event);
}
