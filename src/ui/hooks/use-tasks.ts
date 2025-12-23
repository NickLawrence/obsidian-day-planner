import { flow, groupBy, uniqBy } from "lodash/fp";
import type { Moment } from "moment";
import type { MetadataCache } from "obsidian";
import { derived, type Readable, type Writable } from "svelte/store";

import { defaultDurationMinutes } from "../../constants";
import { addHorizontalPlacing } from "../../overlap/overlap";
import { type PathToListProps } from "../../redux/dataview/dataview-slice";
import { DataviewFacade } from "../../service/dataview-facade";
import type { PeriodicNotes } from "../../service/periodic-notes";
import { WorkspaceFacade } from "../../service/workspace-facade";
import type { DayPlannerSettings } from "../../settings";
import type { LocalTask, RemoteTask, Task, WithTime } from "../../task-types";
import type { OnEditAbortedFn, OnUpdateFn, PointerDateTime } from "../../types";
import { createClockTaskFromActivity } from "../../util/clock";
import { splitMultiday } from "../../util/moment";
import { type LogEntry } from "../../util/props";
import { getUpdateTrigger } from "../../util/store";
import { getDayKey, getRenderKey } from "../../util/task-utils";

import { useDataviewTasks } from "./use-dataview-tasks";
import { useEditContext } from "./use-edit/use-edit-context";
import { useNewlyStartedTasks } from "./use-newly-started-tasks";
import { useVisibleDailyNotes } from "./use-visible-daily-notes";
import { useVisibleDataviewTasks } from "./use-visible-dataview-tasks";

export function useTasks(props: {
  settingsStore: Writable<DayPlannerSettings>;
  debouncedTaskUpdateTrigger: Readable<object>;
  isOnline: Readable<boolean>;
  visibleDays: Readable<Moment[]>;
  layoutReady: Readable<boolean>;
  dataviewFacade: DataviewFacade;
  metadataCache: MetadataCache;
  currentTime: Readable<Moment>;
  workspaceFacade: WorkspaceFacade;
  onUpdate: OnUpdateFn;
  onEditAborted: OnEditAbortedFn;
  pointerDateTime: Readable<PointerDateTime>;
  dataviewChange: Readable<unknown>;
  remoteTasks: Readable<RemoteTask[]>;
  listProps: Readable<PathToListProps>;
  periodicNotes: PeriodicNotes;
}) {
  const {
    settingsStore,
    visibleDays,
    layoutReady,
    debouncedTaskUpdateTrigger,
    dataviewFacade,
    periodicNotes,
    metadataCache,
    currentTime,
    workspaceFacade,
    pointerDateTime,
    dataviewChange,
    onUpdate,
    onEditAborted,
    remoteTasks,
    listProps,
  } = props;

  const visibleDailyNotes = useVisibleDailyNotes(
    layoutReady,
    debouncedTaskUpdateTrigger,
    visibleDays,
    periodicNotes,
  );

  const dataviewTasks = useDataviewTasks({
    dataviewFacade,
    metadataCache,
    settings: settingsStore,
    visibleDailyNotes,
    refreshSignal: debouncedTaskUpdateTrigger,
  });

  const activitiesWithLogs = derived([listProps], ([$listProps]) => {
    return Object.entries($listProps).flatMap(([path, lineToProps]) =>
      Object.values(lineToProps).flatMap(({ parsed, position }) =>
        (parsed.activities ?? [])
          .filter((activity) => activity?.log?.length)
          .map((activity) => ({
            title: activity.activity,
            log: activity.log as LogEntry[],
            taskId: activity.taskId,
            location: {
              path,
              position,
            },
          })),
      ),
    );
  });

  const logSummary = derived([activitiesWithLogs], ([$activitiesWithLogs]) =>
    $activitiesWithLogs.map(({ title, log }) => ({
      title,
      log: log.map(({ start, end }) => ({
        start,
        end: end || "-",
      })),
      timeSpent: log.reduce((result, current) => {
        const start = window.moment(current.start);
        const end = window.moment(current.end);

        return result.add(end.diff(start));
      }, window.moment.duration()),
    })),
  );

  const localTasks = useVisibleDataviewTasks(
    dataviewTasks,
    visibleDays,
    periodicNotes,
  );

  const tasksById = derived(localTasks, ($localTasks) => {
    return new Map(
      $localTasks
        .filter((task): task is LocalTask & { taskId: string } =>
          Boolean(task.taskId),
        )
        .map((task) => [task.taskId, task]),
    );
  });

  const tasksWithActiveClockProps = derived(
    [activitiesWithLogs, currentTime, tasksById],
    ([$activitiesWithLogs, $currentTime, $tasksById]) =>
      $activitiesWithLogs
        .flatMap((activity) => {
          return activity.log
            .filter(({ end }) => typeof end === "undefined")
            .flatMap(({ start }) => {
              const parsedStart = window.moment(
                start,
                window.moment.ISO_8601,
                true,
              );

              return splitMultiday(parsedStart, $currentTime);
            })
            .map((clockMoments) => ({
              activity,
              clockMoments,
            }));
        })
        .map(({ activity, clockMoments }) =>
          createClockTaskFromActivity({
            activity,
            clockMoments,
            tasksById: $tasksById,
            defaultDurationMinutes,
          }),
        ),
  );

  const truncatedTasksWithActiveClockProps = derived(
    [tasksWithActiveClockProps],
    ([$tasksWithActiveClockProps]) =>
      $tasksWithActiveClockProps.map((task) => ({
        ...task,
        truncated: ["bottom" as const],
      })),
  );

  const logRecords = derived(
    [activitiesWithLogs, tasksById],
    ([$activitiesWithLogs, $tasksById]) =>
      $activitiesWithLogs
        .flatMap((activity) => {
          return activity.log
            .filter(({ end }) => typeof end !== "undefined")
            .flatMap(({ start, end }) => {
              const parsedStart = window.moment(
                start,
                window.moment.ISO_8601,
                true,
              );
              const parsedEnd = window.moment(
                end,
                window.moment.ISO_8601,
                true,
              );

              return splitMultiday(parsedStart, parsedEnd);
            })
            .map((clockMoments) => ({
              activity,
              clockMoments,
            }));
        })
        .map(({ activity, clockMoments }) =>
          createClockTaskFromActivity({
            activity,
            clockMoments,
            defaultDurationMinutes,
            tasksById: $tasksById,
          }),
        ),
  );

  const combinedClocks = derived(
    [truncatedTasksWithActiveClockProps, logRecords],
    ([$truncatedTasksWithActiveClockProps, $logRecords]: [
      LocalTask[],
      LocalTask[],
    ]) => $truncatedTasksWithActiveClockProps.concat($logRecords),
  );

  const dayToLogRecords = derived(combinedClocks, ($combinedClocks) =>
    groupBy(({ startTime }) => getDayKey(startTime), $combinedClocks),
  );

  function getDisplayedTasksWithClocksForTimeline(day: Moment) {
    return derived(dayToLogRecords, ($dayToLogRecords) => {
      const tasksForDay = $dayToLogRecords[getDayKey(day)] || [];

      return flow(uniqBy(getRenderKey), addHorizontalPlacing)(tasksForDay);
    });
  }

  const tasksWithTimeForToday = derived(
    [localTasks, remoteTasks, currentTime],
    ([$localTasks, $remoteTasks, $currentTime]: [Task[], Task[], Moment]) => {
      return $localTasks
        .concat($remoteTasks)
        .filter(
          (task): task is WithTime<Task> =>
            task.startTime.isSame($currentTime, "day") && !task.isAllDayEvent,
        );
    },
  );

  const abortEditTrigger = derived(
    [localTasks, dataviewChange],
    getUpdateTrigger,
  );

  const editContext = useEditContext({
    periodicNotes,
    workspaceFacade,
    onUpdate,
    onEditAborted,
    settings: settingsStore,
    localTasks,
    remoteTasks,
    pointerDateTime,
    abortEditTrigger,
  });

  const newlyStartedTasks = useNewlyStartedTasks({
    settings: settingsStore,
    tasksWithTimeForToday,
    currentTime,
  });

  return {
    tasksWithActiveClockProps,
    getDisplayedTasksWithClocksForTimeline,
    tasksWithTimeForToday,
    editContext,
    newlyStartedTasks,
    logSummary,
  };
}
