import { isNotVoid } from "typed-assert";
import type { STask } from "obsidian-dataview";

import { selectListPropsForPath } from "../redux/dataview/dataview-slice";
import type { AppStore } from "../redux/store";
import type { LocalTask } from "../task-types";
import { upsertActivitiesBlock } from "../util/activities-file";
import { replaceSTaskText } from "../util/dataview";
import { getId } from "../util/id";
import {
  getFirstLine,
  getLinesAfterFirst,
  removeListTokens,
} from "../util/markdown";
import {
  addOpenClock,
  cancelOpenClock,
  clockOut,
  createProp,
  type Props,
} from "../util/props";
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

    await this.updateClockPropsForTask(sTask, (props, context) =>
      clockOut(props, context.taskId),
    );
  });

  cancelClockUnderCursor = withNotice(async () => {
    const { sTask } = this.getSTaskUnderCursorFromLastView();

    await this.updateClockPropsForTask(sTask, (props, context) =>
      cancelOpenClock(props, context.taskId),
    );
  });

  clockOutTask = withNotice(async (task: LocalTask) => {
    await this.updateClockPropsForLocalTask(task, (props, context) =>
      clockOut(props, context.taskId),
    );
  });

  cancelClockForTask = withNotice(async (task: LocalTask) => {
    await this.updateClockPropsForLocalTask(task, (props, context) =>
      cancelOpenClock(props, context.taskId),
    );
  });

  constructor(
    private readonly getState: AppStore["getState"],
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
    task: LocalTask,
    updateFn: (
      props: Props,
      context: { taskId: string; activityName: string },
    ) => Props,
  ) {
    const { location, taskId } = task;

    isNotVoid(location, "Cannot update clock for a task without location");
    isNotVoid(taskId, "Cannot update clock for a task without an ID");

    const activityName = this.getActivityName(task.text);

    await this.vaultFacade.editFile(location.path, (contents) =>
      upsertActivitiesBlock({
        fileText: contents,
        updateFn: (props) => updateFn(props, { taskId, activityName }),
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

  private async ensureTaskId(sTask: STask) {
    const existingTaskId = extractPlannerTaskId(getFirstLine(sTask.text));

    if (existingTaskId) {
      return existingTaskId;
    }

    const taskId = getId();
    const updatedFirstLine = appendText(
      getFirstLine(sTask.text),
      ` ${createProp(plannerTaskIdKey, taskId)}`,
    );
    const otherLines = getLinesAfterFirst(sTask.text);
    const updatedText =
      otherLines.length > 0
        ? `${updatedFirstLine}\n${otherLines}`
        : updatedFirstLine;

    await this.vaultFacade.editFile(sTask.path, (contents) =>
      replaceSTaskText(contents, sTask, updatedText),
    );

    return taskId;
  }
}
