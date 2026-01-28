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
import {
  getFirstLine,
  removeListTokens,
} from "../util/markdown";
import {
  addOpenClock,
  cancelOpenClock,
  clockOut,
  createProp,
  type Props,
  taskActivityType,
} from "../util/props";
import {
  activityNotesField,
  buildActivityAttributeUpdate,
  getActivityAttributeFields,
  getActivityLabel,
  qualityRatingField,
} from "../util/activity-definitions";
import { askForActivityAttributes } from "../ui/activity-attributes-modal";
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
        updateFn: (props) => {
          const activityIndex = this.findOpenTaskActivity(props, taskId);

          return clockOut(props, activityIndex, attributeUpdates);
        },
      }),
    );
  });

  cancelClockUnderCursor = withNotice(async () => {
    const { sTask } = this.getSTaskUnderCursorFromLastView();

    await this.updateClockPropsForTask(sTask, (props, context) =>
      cancelOpenClock(props, context.taskId),
    );
  });

  clockOutTask = withNotice(async (
    task: LocalTask & { clockActivity?: Props["activities"][number] },
  ) => {
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
  });

  cancelClockForTask = withNotice(async (task: LocalTask) => {
    isNotVoid(task.taskId, "Cannot update clock for a task without an ID");

    await this.updateClockPropsForLocalTask(task, (props, context) =>
      cancelOpenClock(props, context.taskId as string),
    );
  });

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
          activity.taskId === taskId &&
          activity.log?.some((entry) => !entry.end),
      ),
    );
  }

  private findActivityIndexForClockActivity(
    props: Props,
    clockActivity?: Props["activities"][number],
  ) {
    const openStart = clockActivity?.log?.find((entry) => !entry.end)?.start;

    if (!openStart) {
      return -1;
    }

    return (props.activities ?? []).findIndex((activity) => {
      if (clockActivity?.taskId && activity.taskId !== clockActivity.taskId) {
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

  private findOpenTaskActivity(props: Props, taskId?: string) {
    if (!taskId) {
      return -1;
    }

    return (props.activities ?? []).findIndex(
      (activity) =>
        activity.taskId === taskId &&
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
        updateFn: (props) => updateFn(props, { taskId, activityName }),
      }),
    );

    return taskId;
  }

  private async updateClockPropsForLocalTask(
    task: LocalTask & { clockActivity?: Props["activities"][number] },
    updateFn: (
      props: Props,
      context: {
        taskId?: string;
        activityName: string;
        clockActivity?: Props["activities"][number];
      },
    ) => Props,
  ) {
    const { clockActivity, location, taskId } = task;

    isNotVoid(location, "Cannot update clock for a task without location");

    const activityName = this.getActivityName(task.text);

    await this.vaultFacade.editFile(location.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
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
