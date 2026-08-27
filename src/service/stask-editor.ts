import { type App } from "obsidian";
import { isNotVoid } from "typed-assert";
import type { STask } from "obsidian-dataview";

import { selectListPropsForPath } from "../redux/dataview/dataview-slice";
import type { AppStore } from "../redux/store";
import type { LocalTask } from "../task-types";
import { upsertActivitiesBlock } from "../util/activities-file";
import {
  replaceSTaskText,
  textToMarkdownWithIndentation,
} from "../util/dataview";
import { getId } from "../util/id";
import { getFirstLine, removeListTokens } from "../util/markdown";
import {
  addOpenClock,
  addTaskToOpenActivity,
  appendNoteToActivity,
  cancelOpenClock,
  cancelOpenClockByActivityIndex,
  clockOut,
  createProp,
  type Activity,
  type Props,
  taskActivityType,
  updateActivityDetails,
  updateActivityLogEntry,
} from "../util/props";
import {
  activityNotesField,
  buildActivityAttributeUpdate,
  getActivityAttributeFields,
  getActivityLabel,
  qualityRatingField,
} from "../util/activity-definitions";
import { askForActivityAttributes } from "../ui/activity-attributes-modal";
import { askForConfirmation } from "../ui/confirmation-modal";
import { propRegexp } from "../regexp";
import { extractPlannerTaskId, plannerTaskIdKey } from "../util/task-id";
import { appendText, removeTimestampFromStart } from "../util/task-utils";
import { withNotice } from "../util/with-notice";

import { DataviewFacade } from "./dataview-facade";
import type { VaultFacade } from "./vault-facade";
import { WorkspaceFacade } from "./workspace-facade";

export class STaskEditor {
  clockInUnderCursor = withNotice(async () => {
    const { sTask } = this.getSTaskUnderCursorFromLastView();

    await this.updateClockPropsForTask(sTask, (props, context) =>
      addOpenClock(props, context),
    );
  });

  addTaskToCurrentActivity = withNotice(async (task: LocalTask) => {
    isNotVoid(task.location, "Cannot update task without location");

    const { location } = task;
    const sTask = this.dataviewFacade.getTaskAtLine({
      path: location.path,
      line: location.position.start.line,
    });

    isNotVoid(sTask, "No task found for selected time block");

    const taskId = await this.ensureTaskId(sTask);

    await this.vaultFacade.editFile(location.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        filePath: location.path,
        updateFn: (props) => addTaskToOpenActivity(props, taskId),
      }),
    );
  });

  addTaskUnderCursorToCurrentActivity = withNotice(async () => {
    const { sTask } = this.getSTaskUnderCursorFromLastView();
    const taskId = await this.ensureTaskId(sTask);

    await this.vaultFacade.editFile(sTask.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        filePath: sTask.path,
        updateFn: (props) => addTaskToOpenActivity(props, taskId),
      }),
    );
  });

  addNoteToClockActivity = withNotice(
    async (task: LocalTask & { clockActivity?: Activity }) => {
      const values = await askForActivityAttributes(this.app, {
        title: "Add note to activity",
        fields: [activityNotesField],
      });

      const note = values?.notes;

      if (typeof note !== "string" || note.trim().length === 0) {
        return;
      }

      await this.updateClockPropsForLocalTask(task, (props, context) => {
        const activityIndexByClock = this.findActivityIndexForClockActivity(
          props,
          context.clockActivity,
        );
        const activityIndexBySelectedLog =
          activityIndexByClock === -1
            ? this.findActivityIndexForSelectedClockActivity(
                props,
                context.clockActivity,
              )
            : activityIndexByClock;
        const activityIndex =
          activityIndexBySelectedLog === -1
            ? this.findOpenActivityByName(props, context.activityName)
            : activityIndexBySelectedLog;

        return appendNoteToActivity(props, activityIndex, note);
      });
    },
  );

  changeClockActivityStartTime = withNotice(
    async (task: LocalTask & { clockActivity?: Activity }) => {
      const logEntry = this.getClockActivityLogEntry(task);
      const values = await askForActivityAttributes(this.app, {
        title: "Change start time",
        fields: [
          { key: "start", label: "Start time", type: "text", required: true },
        ],
        initialValues: { start: logEntry?.start },
      });
      const start = values?.start;

      if (typeof start !== "string") {
        return;
      }

      this.validateClockTimestamp(start, "Start time");

      await this.updateClockPropsForLocalTask(task, (props, context) => {
        const { activityIndex, logEntryIndex } = this.findClockActivityLogEntry(
          props,
          context.clockActivity,
        );

        return updateActivityLogEntry(props, activityIndex, logEntryIndex, {
          start,
        });
      });
    },
  );

  changeClockActivityEndTime = withNotice(
    async (task: LocalTask & { clockActivity?: Activity }) => {
      const logEntry = this.getClockActivityLogEntry(task);
      const values = await askForActivityAttributes(this.app, {
        title: "Change end time",
        fields: [
          { key: "end", label: "End time", type: "text", required: true },
        ],
        initialValues: { end: logEntry?.end },
      });
      const end = values?.end;

      if (typeof end !== "string") {
        return;
      }

      this.validateClockTimestamp(end, "End time");

      await this.updateClockPropsForLocalTask(task, (props, context) => {
        const { activityIndex, logEntryIndex } = this.findClockActivityLogEntry(
          props,
          context.clockActivity,
        );

        return updateActivityLogEntry(props, activityIndex, logEntryIndex, {
          end,
        });
      });
    },
  );

  changeClockActivityRating = withNotice(
    async (task: LocalTask & { clockActivity?: Activity }) => {
      const values = await askForActivityAttributes(this.app, {
        title: "Change rating",
        fields: [qualityRatingField],
        initialValues: { quality: task.clockActivity?.quality },
      });
      const quality = values?.quality;

      if (typeof quality !== "number") {
        return;
      }

      await this.updateClockPropsForLocalTask(task, (props, context) => {
        const activityIndex = this.findClockActivityLogEntry(
          props,
          context.clockActivity,
        ).activityIndex;

        return updateActivityDetails(props, activityIndex, { quality });
      });
    },
  );

  addNoteToFirstActiveClock = withNotice(async () => {
    const openActivities = this.getOpenActivities();

    if (openActivities.length === 0) {
      throw new Error("There is no open clock");
    }

    const target = openActivities[0];
    const values = await askForActivityAttributes(this.app, {
      title: "Add note to activity",
      fields: [activityNotesField],
    });

    const note = values?.notes;

    if (typeof note !== "string" || note.trim().length === 0) {
      return;
    }

    await this.vaultFacade.editFile(target.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        filePath: target.path,
        updateFn: (props) =>
          appendNoteToActivity(props, target.activityIndex, note),
      }),
    );
  });
  clockOutUnderCursor = withNotice(async () => {
    const { sTask } = this.getSTaskUnderCursorFromLastView();

    const taskId = await this.ensureTaskId(sTask);
    const activityName = this.getActivityName(sTask.text);
    const attributeUpdates = await this.getClockOutAttributeUpdates({
      activityName,
      taskId,
    });

    if (attributeUpdates === null) {
      return;
    }

    await this.vaultFacade.editFile(sTask.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        filePath: sTask.path,
        updateFn: (props) => {
          const activityIndex = this.findOpenTaskActivity(props, taskId);

          return clockOut(props, activityIndex, attributeUpdates);
        },
      }),
    );
  });

  cancelClockUnderCursor = withNotice(async () => {
    const shouldCancel = await askForConfirmation({
      app: this.app,
      title: "Cancel clock",
      text: "Are you sure you want to cancel this clock?",
      cta: "Cancel clock",
    });

    if (!shouldCancel) {
      return;
    }

    const { sTask } = this.getSTaskUnderCursorFromLastView();

    await this.updateClockPropsForTask(sTask, (props, context) =>
      cancelOpenClock(props, context.taskId),
    );
  });

  clockOutTask = withNotice(
    async (task: LocalTask & { clockActivity?: Activity }) => {
      const activityName =
        task.clockActivity?.activity ?? this.getActivityName(task.text);
      const attributeUpdates = await this.getClockOutAttributeUpdates({
        activityName,
        taskId: task.taskId,
      });

      if (attributeUpdates === null) {
        return;
      }

      await this.updateClockPropsForLocalTask(task, (props, context) => {
        const activityIndexByClock = this.findActivityIndexForClockActivity(
          props,
          context.clockActivity,
        );
        const activityIndexByTaskId =
          activityIndexByClock === -1
            ? this.findOpenTaskActivity(props, context.taskId)
            : activityIndexByClock;

        const activityIndex =
          activityIndexByTaskId === -1
            ? this.findOpenActivityByName(props, context.activityName)
            : activityIndexByTaskId;

        return clockOut(props, activityIndex, attributeUpdates);
      });
    },
  );

  cancelClockForTask = withNotice(async (task: LocalTask) => {
    const shouldCancel = await askForConfirmation({
      app: this.app,
      title: "Cancel clock",
      text: "Are you sure you want to cancel this clock?",
      cta: "Cancel clock",
    });

    if (!shouldCancel) {
      return;
    }

    await this.updateClockPropsForLocalTask(task, (props, context) => {
      const activityIndexByClock = this.findActivityIndexForClockActivity(
        props,
        context.clockActivity,
      );
      const activityIndexByTaskId =
        activityIndexByClock === -1
          ? this.findOpenTaskActivity(props, context.taskId)
          : activityIndexByClock;

      const activityIndex =
        activityIndexByTaskId === -1
          ? this.findOpenActivityByName(props, context.activityName)
          : activityIndexByTaskId;

      return cancelOpenClockByActivityIndex(props, activityIndex);
    });
  });

  private getOpenActivities() {
    const listProps = this.getState().dataview.listProps;

    return Object.entries(listProps).flatMap(([path, lineToProps]) =>
      Object.values(lineToProps).flatMap(({ parsed }) =>
        (parsed.activities ?? [])
          .map((activity, activityIndex) => ({ path, activity, activityIndex }))
          .filter(({ activity }) => activity.log?.some((entry) => !entry.end)),
      ),
    );
  }

  constructor(
    private readonly getState: AppStore["getState"],
    private readonly app: App,
    private readonly workspaceFacade: WorkspaceFacade,
    private readonly vaultFacade: VaultFacade,
    private readonly dataviewFacade: DataviewFacade,
  ) {}

  getSTaskUnderCursorFromLastView = () => {
    const location = this.workspaceFacade.getLastCaretLocation();
    const { path, line } = location;
    const sTask = this.dataviewFacade.getTaskAtLine({ path, line });

    isNotVoid(sTask, "No task under cursor");

    return { sTask, location };
  };

  hasOpenClockForTask(sTask: STask) {
    const taskId = extractPlannerTaskId(getFirstLine(sTask.text));

    if (!taskId) {
      return false;
    }

    const listProps = selectListPropsForPath(this.getState(), sTask.path) || {};

    return Object.values(listProps).some(({ parsed }) =>
      parsed.activities?.some(
        (activity) =>
          activity.taskIds.includes(taskId) &&
          activity.log?.some((entry) => !entry.end),
      ),
    );
  }

  private getClockActivityLogEntry(
    task: LocalTask & { clockActivity?: Activity },
  ) {
    const logEntry = task.clockActivity?.log?.[0];

    isNotVoid(logEntry, "Cannot find selected activity log entry");

    return logEntry;
  }

  private findClockActivityLogEntry(props: Props, clockActivity?: Activity) {
    const selectedLogEntry = clockActivity?.log?.[0];

    isNotVoid(selectedLogEntry, "Cannot find selected activity log entry");

    const activityIndex = (props.activities ?? []).findIndex((activity) => {
      if (activity.activity !== clockActivity?.activity) {
        return false;
      }

      const clockTaskId = clockActivity?.taskIds?.[0];
      if (clockTaskId && !activity.taskIds.includes(clockTaskId)) {
        return false;
      }

      return activity.log?.some(
        (entry) =>
          entry.start === selectedLogEntry.start &&
          entry.end === selectedLogEntry.end,
      );
    });

    if (activityIndex === -1) {
      throw new Error("Cannot find selected activity");
    }

    const logEntryIndex = props.activities?.[activityIndex]?.log?.findIndex(
      (entry) =>
        entry.start === selectedLogEntry.start &&
        entry.end === selectedLogEntry.end,
    );

    if (typeof logEntryIndex !== "number" || logEntryIndex === -1) {
      throw new Error("Cannot find selected activity log entry");
    }

    return { activityIndex, logEntryIndex };
  }

  private validateClockTimestamp(value: string, label: string) {
    if (!window.moment(value, window.moment.ISO_8601, true).isValid()) {
      throw new Error(`${label} must be a valid timestamp`);
    }
  }

  private findActivityIndexForClockActivity(
    props: Props,
    clockActivity?: Activity,
  ) {
    const openStart = clockActivity?.log?.find((entry) => !entry.end)?.start;

    if (!openStart) {
      return -1;
    }

    return (props.activities ?? []).findIndex((activity) => {
      const clockTaskId = clockActivity?.taskIds?.[0];
      if (clockTaskId && !activity.taskIds.includes(clockTaskId)) {
        return false;
      }

      if (activity.activity !== clockActivity?.activity) {
        return false;
      }

      return activity.log?.some(
        (entry) => !entry.end && entry.start === openStart,
      );
    });
  }

  private findActivityIndexForSelectedClockActivity(
    props: Props,
    clockActivity?: Activity,
  ) {
    const selectedLogEntry = clockActivity?.log?.[0];

    if (!selectedLogEntry) {
      return -1;
    }

    return (props.activities ?? []).findIndex((activity) => {
      if (activity.activity !== clockActivity?.activity) {
        return false;
      }

      const clockTaskId = clockActivity?.taskIds?.[0];
      if (clockTaskId && !activity.taskIds.includes(clockTaskId)) {
        return false;
      }

      return activity.log?.some(
        (entry) =>
          entry.start === selectedLogEntry.start &&
          entry.end === selectedLogEntry.end,
      );
    });
  }

  private findOpenTaskActivity(props: Props, taskId?: string) {
    if (!taskId) {
      return -1;
    }

    return (props.activities ?? []).findIndex(
      (activity) =>
        activity.taskIds.includes(taskId) &&
        activity.activity === taskActivityType &&
        activity.log?.some((entry) => !entry.end),
    );
  }

  private findOpenActivityByName(props: Props, activityName: string) {
    return (props.activities ?? []).findIndex(
      (activity) =>
        activity.activity === activityName &&
        activity.log?.some((entry) => !entry.end),
    );
  }

  private async updateClockPropsForTask(
    sTask: STask,
    updateFn: (
      props: Props,
      context: { taskId: string; activityName: string },
    ) => Props,
  ) {
    const taskId = await this.ensureTaskId(sTask);
    const activityName = this.getActivityName(sTask.text);

    await this.vaultFacade.editFile(sTask.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        filePath: sTask.path,
        updateFn: (props) => updateFn(props, { taskId, activityName }),
      }),
    );

    return taskId;
  }

  private async updateClockPropsForLocalTask(
    task: LocalTask & { clockActivity?: Activity },
    updateFn: (
      props: Props,
      context: {
        taskId?: string;
        activityName: string;
        clockActivity?: Activity;
      },
    ) => Props,
  ) {
    const { clockActivity, location, taskId } = task;

    isNotVoid(location, "Cannot update clock for a task without location");

    const activityName = this.getActivityName(task.text);

    await this.vaultFacade.editFile(location.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        filePath: location.path,
        updateFn: (props) =>
          updateFn(props, { taskId, activityName, clockActivity }),
      }),
    );
  }

  private getActivityName(text: string) {
    return removeTimestampFromStart(
      removeListTokens(getFirstLine(text)).replace(propRegexp, ""),
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  private async getClockOutAttributeUpdates(props: {
    activityName: string;
    taskId?: string;
  }) {
    const { activityName, taskId } = props;

    const endFields = getActivityAttributeFields(activityName, "end");
    const fields = [...endFields, qualityRatingField, activityNotesField];

    if (fields.length === 0) {
      return {};
    }

    const values = await askForActivityAttributes(this.app, {
      title: `Finish ${getActivityLabel(activityName)}`,
      fields,
    });

    if (!values) {
      return null;
    }

    const qualityValue = values.quality;
    const notesValue = values.notes;
    const { quality, notes, ...attributeValues } = values;
    const attributeUpdates = buildActivityAttributeUpdate(
      activityName,
      attributeValues,
    );

    return {
      ...attributeUpdates,
      ...(typeof qualityValue === "number" ? { quality: qualityValue } : {}),
      ...(typeof notesValue === "string" ? { notes: notesValue } : {}),
    };
  }

  private async ensureTaskId(sTask: STask) {
    const existingTaskId = extractPlannerTaskId(getFirstLine(sTask.text));

    if (existingTaskId) {
      return existingTaskId;
    }

    const taskId = getId();
    const textWithIndentation = textToMarkdownWithIndentation(sTask);
    const [firstLine, ...otherLines] = textWithIndentation.split("\n");

    const updatedFirstLine = appendText(
      firstLine,
      ` ${createProp(plannerTaskIdKey, taskId)}`,
    );
    const updatedText = otherLines.length
      ? [updatedFirstLine, ...otherLines].join("\n")
      : updatedFirstLine;

    await this.vaultFacade.editFile(sTask.path, (contents) =>
      replaceSTaskText(contents, sTask, updatedText),
    );

    return taskId;
  }
}
