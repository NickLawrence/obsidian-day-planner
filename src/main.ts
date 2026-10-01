import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  type MarkdownFileInfo,
} from "obsidian";
import { getAPI } from "obsidian-dataview";
import {
  fromStore,
  get,
  writable,
  type Readable,
  type Writable,
} from "svelte/store";
import { isInstanceOf, isNotVoid } from "typed-assert";

import {
  errorContextKey,
  obsidianContextKey,
  viewTypeReleaseNotes,
  viewTypeTimeline,
  viewTypeMultiDay,
  viewTypeMonthlyCalendar,
  reQueryAfterMillis,
  icalRefreshIntervalMillis,
  viewTypeLogSummary,
  viewTypeActivityQueue,
} from "./constants";
import {
  createUpdateHandler,
  getActivityNameFromUser,
  getTextFromUser,
} from "./create-update-handler";
import { createDumpMetadataCommand } from "./dump-metadata";
import { currentTime } from "./global-store/current-time";
import { settings } from "./global-store/settings";
import {
  compareByTimestampInText,
  fromMarkdown,
  positionContainsPoint,
  sortListsRecursively,
  toEditorPos,
  toMarkdown,
  toMdastPoint,
} from "./mdast/mdast";
import {
  dataviewChange,
  dataviewTasksUpdated,
  activitiesLoaded,
  type PathToListProps,
} from "./redux/dataview/dataview-slice";
import { editCanceled, visibleDaysUpdated } from "./redux/global-slice";
import {
  icalRefreshRequested,
  type IcalState,
  initialIcalState,
} from "./redux/ical/ical-slice";
import { settingsUpdated } from "./redux/settings-slice";
import { type AppDispatch, createReactor } from "./redux/store";
import { createUseSelector } from "./redux/use-selector";
import { DataviewFacade } from "./service/dataview-facade";
import { TransactionWriter } from "./service/diff-writer";
import {
  completeFitbitLinking,
  shouldAutoSyncFitbit,
  startFitbitAuthorization,
  syncFitbitData,
} from "./service/fitbit";
import { ListPropsParser } from "./service/list-props-parser";
import { PeriodicNotes } from "./service/periodic-notes";
import { PlannerData } from "./service/planner-data";
import { STaskEditor } from "./service/stask-editor";
import { VaultFacade } from "./service/vault-facade";
import { WorkspaceFacade } from "./service/workspace-facade";
import {
  type DayPlannerSettings,
  defaultSettings,
  type PluginData,
} from "./settings";
import type { RemoteTask } from "./task-types";
import { createGetTasksApi } from "./tasks-plugin";
import type { ObsidianContext, OnUpdateFn, PointerDateTime } from "./types";
import { askForActivityAttributes } from "./ui/activity-attributes-modal";
import { renderActivityDashboardCodeBlock } from "./ui/activity-dashboard-code-block";
import { renderActivityGoalsCodeBlock } from "./ui/activity-goals-code-block";
import { renderActivityPlanCodeBlock } from "./ui/activity-plan-code-block";
import { ActivityQueueView } from "./ui/activity-queue-view";
import { askForConfirmation } from "./ui/confirmation-modal";
import { createEditorMenuCallback } from "./ui/editor-menu";
import { useDateRanges } from "./ui/hooks/use-date-ranges";
import { useDebounceWithDelay } from "./ui/hooks/use-debounce-with-delay";
import { mountStatusBarWidget } from "./ui/hooks/use-status-bar-widget";
import { useTasks } from "./ui/hooks/use-tasks";
import { useVisibleDays } from "./ui/hooks/use-visible-days";
import { LogSummaryView } from "./ui/log-summary";
import MonthlyView from "./ui/monthly-view";
import MultiDayView from "./ui/multi-day-view";
import { DayPlannerReleaseNotesView } from "./ui/release-notes";
import { DayPlannerSettingsTab } from "./ui/settings-tab";
import TimelineView from "./ui/timeline-view";
import { createUndoNotice } from "./ui/undo-notice";
import {
  buildActivityAttributeUpdate,
  getActivityAttributeFields,
  getActivityLabel,
} from "./util/activity-definitions";
import { getActivityFieldOptions } from "./util/activity-resources";
import {
  createDayPlannerActivityApi,
  type DayPlannerActivityApi,
} from "./util/activity-totals";
import { createEnvironmentHooks } from "./util/create-environment-hooks";
import { createRenderMarkdown } from "./util/create-render-markdown";
import { createShowPreview } from "./util/create-show-preview";
import { notifyAboutStartedTasks } from "./util/notify-about-started-tasks";
import { propsSchema, startActivityLog } from "./util/props";

export default class DayPlanner extends Plugin {
  settings!: () => DayPlannerSettings;
  private settingsStore!: Writable<DayPlannerSettings>;
  private workspaceFacade!: WorkspaceFacade;
  private dataviewFacade!: DataviewFacade;
  private periodicNotes!: PeriodicNotes;
  private sTaskEditor!: STaskEditor;
  private vaultFacade!: VaultFacade;
  private transactionWriter!: TransactionWriter;
  private plannerData!: PlannerData;
  public api!: DayPlannerActivityApi;

  beginFitbitLink = async () => {
    await startFitbitAuthorization({
      settings: this.settings(),
      onSettingsUpdate: (patch) =>
        this.settingsStore.update((s) => ({ ...s, ...patch })),
    });
  };

  completeFitbitLink = async (code: string) => {
    const patch = await completeFitbitLinking({
      settings: this.settings(),
      code,
    });

    this.settingsStore.update((previous) => ({ ...previous, ...patch }));
  };

  unlinkFitbit = () => {
    this.settingsStore.update((previous) => ({
      ...previous,
      fitbitCodeVerifier: "",
      fitbitAccessToken: "",
      fitbitRefreshToken: "",
      fitbitTokenExpiresAt: 0,
      fitbitUserId: "",
      fitbitLastSyncAt: 0,
      fitbitLastDateSynced: "",
    }));
  };

  reSyncFitbit = async (force = true) => {
    const patch = await syncFitbitData({
      vault: this.app.vault,
      settings: this.settings(),
      force,
    });

    if (!patch) {
      return;
    }

    this.settingsStore.update((previous) => ({ ...previous, ...patch }));
  };

  async onload() {
    const initialPluginData: PluginData = {
      ...defaultSettings,
      ...(await this.loadData()),
    };

    const getTasksApi = createGetTasksApi(this.app);
    const listPropsParser = new ListPropsParser(
      this.app.vault,
      this.app.metadataCache,
    );

    this.periodicNotes = new PeriodicNotes();
    this.plannerData = new PlannerData(this.app.vault);
    this.vaultFacade = new VaultFacade(this.app.vault, getTasksApi);
    this.transactionWriter = new TransactionWriter(this.vaultFacade);
    this.workspaceFacade = new WorkspaceFacade(
      this.app.workspace,
      this.vaultFacade,
      this.periodicNotes,
    );
    this.dataviewFacade = new DataviewFacade(
      () => getAPI(this.app),
      this.app.vault,
    );

    const icalStateWithCachedRawIcals: IcalState = {
      ...initialIcalState,
      plainTextIcals: initialPluginData.rawIcals || [],
    };

    const {
      dispatch,
      useSelector,
      listenerMiddleware,
      remoteTasks,
      taskUpdateTrigger,
      listProps,
      dataviewLoaded,
      pointerDateTime,
      dataviewRefreshSignal,
    } = createReactor({
      preloadedState: {
        ical: icalStateWithCachedRawIcals,
      },
      dataviewFacade: this.dataviewFacade,
      listPropsParser,
      onIcalsFetched: async (rawIcals) => {
        await this.saveData({ ...this.settings(), rawIcals });
      },
    });

    const refreshActivities = () =>
      dispatch(activitiesLoaded(this.plannerData.asListProps()));
    refreshActivities();
    this.register(this.plannerData.onChange(refreshActivities));
    let plannerDataReady = false;
    const reloadPlannerData = (file: TFile) => {
      if (plannerDataReady && this.plannerData.isDataPath(file.path)) {
        void this.plannerData.loadActivities().catch((error) => {
          console.error("Failed to reload planner activity data", error);
          new Notice(
            "Failed to reload planner activity data; see console for details.",
          );
        });
      }
    };
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) reloadPlannerData(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) reloadPlannerData(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) reloadPlannerData(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile) reloadPlannerData(file);
      }),
    );

    this.api = createDayPlannerActivityApi(listProps);

    this.sTaskEditor = new STaskEditor(
      this.app,
      this.workspaceFacade,
      this.vaultFacade,
      this.dataviewFacade,
      this.plannerData,
    );

    this.register(() => {
      listenerMiddleware.clearListeners();
    });

    this.initSettingsStore({ initialSettings: initialPluginData, dispatch });
    this.registerViews({
      dispatch,
      remoteTasks,
      taskUpdateTrigger,
      listProps,
      dataviewLoaded,
      pointerDateTime,
      dataviewRefreshSignal,
      useSelector,
    });

    const handleEditorMenu = createEditorMenuCallback({
      sTaskEditor: this.sTaskEditor,
      plugin: this,
    });

    this.registerEvent(this.app.workspace.on("editor-menu", handleEditorMenu));

    this.registerCommands();
    this.addRibbonIcons();
    this.addSettingTab(new DayPlannerSettingsTab(this, this.settingsStore));

    this.registerMarkdownCodeBlockProcessor("activitygoals", (_, el, ctx) => {
      renderActivityGoalsCodeBlock({
        app: this.app,
        el,
        ctx,
        periodicNotes: this.periodicNotes,
        plannerData: this.plannerData,
        activityApi: this.api,
      });
    });

    this.registerMarkdownCodeBlockProcessor(
      "activitydashboard",
      (_, el, ctx) => {
        renderActivityDashboardCodeBlock({
          app: this.app,
          el,
          ctx,
          activityApi: this.api,
          plannerData: this.plannerData,
        });
      },
    );

    this.registerMarkdownCodeBlockProcessor("activityplan", (_, el, ctx) => {
      renderActivityPlanCodeBlock({
        app: this.app,
        el,
        ctx,
        periodicNotes: this.periodicNotes,
        plannerData: this.plannerData,
      });
    });

    // Vault folders may not be available
    // during onload. Do not await layout readiness here: plugin loading must
    // finish before Obsidian can signal that the layout is ready.
    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.plannerData.loadActivities();
        plannerDataReady = true;
      } catch (error) {
        console.error("Failed to initialize planner data", error);
        new Notice(
          "Failed to initialize planner data; see console for details.",
        );
      }
    });

    await this.handleNewPluginVersion();
    await this.initTimelineLeafSilently();
  }

  async onunload() {
    return Promise.all([
      this.detachLeavesOfType(viewTypeTimeline),
      this.detachLeavesOfType(viewTypeMultiDay),
      this.detachLeavesOfType(viewTypeMonthlyCalendar),
      this.detachLeavesOfType(viewTypeActivityQueue),
    ]);
  }

  addRibbonIcons() {
    this.addRibbonIcon(
      "calendar-range",
      "Open Timeline",
      this.initTimelineLeaf,
    );
    this.addRibbonIcon("table-2", "Open Multi-Day View", this.initWeeklyLeaf);
    this.addRibbonIcon(
      "calendar-clock",
      "Open Planner Dashboard",
      this.initMonthlyLeaf,
    );
    this.addRibbonIcon(
      "star-list",
      "Open Activity Queue",
      this.initActivityQueueLeaf,
    );
  }

  private startActivityWithSelection = async (activitySelection: {
    activityName: string;
    initialValues?: Record<string, string | number | undefined>;
  }) => {
    const activityName = activitySelection.activityName;

    if (!activityName) {
      return { started: false };
    }

    const trimmedName = activityName.trim();

    if (trimmedName.length === 0) {
      new Notice("Activity name cannot be empty");

      return { started: false };
    }

    const startFields = getActivityAttributeFields(trimmedName, "start");
    let attributeUpdates: Record<string, unknown> | undefined;

    if (startFields.length > 0) {
      const values = await askForActivityAttributes(this.app, {
        title: `Start ${getActivityLabel(trimmedName)}`,
        fields: startFields,
        initialValues: activitySelection?.initialValues,
        fieldOptions: getActivityFieldOptions(
          this.app,
          trimmedName,
          startFields,
          this.api.getAllActivities(),
        ),
      });

      if (!values) {
        return { started: false };
      }

      attributeUpdates = buildActivityAttributeUpdate(trimmedName, values);
    }

    const activity = propsSchema.parse(
      startActivityLog({}, trimmedName, attributeUpdates),
    ).activities?.[0];
    isNotVoid(activity);
    await this.plannerData.addActivity(activity);

    new Notice(`Started activity "${trimmedName}"`);
    return { started: true };
  };

  private startActivity = async () => {
    const activitySelection = await getActivityNameFromUser(
      this.app,
      this.api.getAllActivities(),
    );

    if (!activitySelection) {
      return;
    }

    await this.startActivityWithSelection(activitySelection);
  };

  initWeeklyLeaf = async () => {
    await this.app.workspace.getLeaf("tab").setViewState({
      type: viewTypeMultiDay,
      active: true,
    });
  };

  initMonthlyLeaf = async () => {
    await this.app.workspace.getLeaf("tab").setViewState({
      type: viewTypeMonthlyCalendar,
      active: true,
    });
  };

  initActivityQueueLeaf = async () => {
    const [existing] = this.app.workspace.getLeavesOfType(
      viewTypeActivityQueue,
    );
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }

    await this.detachLeavesOfType(viewTypeActivityQueue);
    await this.app.workspace.getRightLeaf(false)?.setViewState({
      type: viewTypeActivityQueue,
      active: true,
    });
    this.app.workspace.rightSplit.expand();
  };

  initTimelineLeafSilently = async () => {
    this.app.workspace.onLayoutReady(async () => {
      const [firstExistingTimeline] =
        this.app.workspace.getLeavesOfType(viewTypeTimeline);
      if (firstExistingTimeline) {
        return;
      }

      await this.detachLeavesOfType(viewTypeTimeline);

      await this.app.workspace.getRightLeaf(false)?.setViewState({
        type: viewTypeTimeline,
      });
    });
  };

  initTimelineLeaf = async () => {
    const [firstExistingTimeline] =
      this.app.workspace.getLeavesOfType(viewTypeTimeline);

    if (firstExistingTimeline) {
      this.app.workspace.revealLeaf(firstExistingTimeline);
      return;
    }

    await this.detachLeavesOfType(viewTypeTimeline);
    await this.app.workspace.getRightLeaf(false)?.setViewState({
      type: viewTypeTimeline,
      active: true,
    });
    this.app.workspace.rightSplit.expand();
  };

  private async handleNewPluginVersion() {
    if (this.settings().pluginVersion === currentPluginVersion) {
      return;
    }

    this.settingsStore.update((previous) => ({
      ...previous,
      pluginVersion: currentPluginVersion,
    }));

    if (this.settings().releaseNotes) {
      this.app.workspace.onLayoutReady(async () => {
        await this.showReleaseNotes();
      });
    }
  }

  private registerCommands() {
    this.addCommand({
      id: "show-day-planner-timeline",
      name: "Show timeline",
      callback: async () => await this.initTimelineLeaf(),
    });

    this.addCommand({
      id: "show-weekly-view",
      name: "Show week planner",
      callback: this.initWeeklyLeaf,
    });

    this.addCommand({
      id: "show-multi-day-view",
      name: "Show multi-day planner",
      callback: this.initWeeklyLeaf,
    });

    this.addCommand({
      id: "show-monthly-calendar",
      name: "Show planner dashboard",
      callback: this.initMonthlyLeaf,
    });

    this.addCommand({
      id: "show-log-summary",
      name: "Show log summary",
      callback: async () =>
        await this.app.workspace.getLeaf().setViewState({
          type: viewTypeLogSummary,
          active: true,
        }),
    });
    this.addCommand({
      id: "show-activity-queue",
      name: "Show activity queue",
      callback: this.initActivityQueueLeaf,
    });

    this.addCommand({
      id: "show-day-planner-today-note",
      name: "Open today's Day Planner",
      callback: async () => {
        const dailyNote = await this.periodicNotes.createDailyNoteIfNeeded(
          window.moment(),
        );

        await this.app.workspace.getLeaf(false).openFile(dailyNote);
      },
    });

    this.addCommand({
      id: "reorder-tasks-by-time",
      name: "Sort tasks under cursor by time",
      editorCallback: (editor) => {
        const mdastRoot = fromMarkdown(editor.getValue());
        const cursorPoint = toMdastPoint(editor.getCursor());

        // todo: move out
        const list = mdastRoot.children.find(
          (rootContent) =>
            rootContent.position &&
            positionContainsPoint(rootContent.position, cursorPoint),
        );

        if (!list) {
          new Notice("There is no list under cursor");

          return;
        }

        const sorted = sortListsRecursively(list, compareByTimestampInText);
        const updatedText = toMarkdown(sorted).trim();

        isNotVoid(sorted.position);

        editor.replaceRange(
          updatedText,
          toEditorPos(sorted.position.start),
          toEditorPos(sorted.position.end),
        );
      },
    });

    this.addCommand({
      id: "clock-in",
      icon: "play",
      name: "Clock in",
      editorCallback: () => this.sTaskEditor.clockInUnderCursor(),
    });

    this.addCommand({
      id: "start-activity",
      name: "Start Activity",
      callback: this.startActivity,
    });

    this.addCommand({
      icon: "square",
      id: "clock-out",
      name: "Clock out",
      editorCallback: () => this.sTaskEditor.clockOutUnderCursor(),
    });

    this.addCommand({
      icon: "trash-2",
      id: "cancel-clock",
      name: "Cancel clock",
      editorCallback: () => this.sTaskEditor.cancelClockUnderCursor(),
    });

    this.addCommand({
      id: "add-note-to-activity",
      name: "Add Note to Activity",
      callback: () => this.sTaskEditor.addNoteToFirstActiveClock(),
    });
  }

  private initSettingsStore(props: {
    initialSettings: DayPlannerSettings;
    dispatch: AppDispatch;
  }) {
    const { initialSettings, dispatch } = props;

    settings.set(initialSettings);

    this.register(
      settings.subscribe(async (newValue) => {
        dispatch(settingsUpdated(newValue));

        await this.saveData(newValue);
      }),
    );

    this.settingsStore = settings;
    this.settings = () => get(settings);
  }

  private async detachLeavesOfType(type: string) {
    // Although this is synchronous, without wrapping into a promise, weird things happen:
    // - when re-initializing the weekly view, it gets deleted every other time instead of getting re-created
    // - or the tabs get hidden
    await this.app.workspace.detachLeavesOfType(type);
  }

  private showReleaseNotes = async () => {
    await this.app.workspace.getLeaf("tab").setViewState({
      type: viewTypeReleaseNotes,
      active: true,
    });
  };

  getSTaskUnderCursor = (view: MarkdownFileInfo) => {
    isInstanceOf(
      view,
      MarkdownView,
      "You can only get tasks from markdown editor views",
    );

    const file = view.file;

    isNotVoid(file, "There is no file for view");

    const sTask = this.dataviewFacade.getTaskAtLine({
      path: file.path,
      line: view.editor.getCursor().line,
    });

    isNotVoid(sTask, "There is no task under cursor");

    return sTask;
  };

  private registerViews(props: {
    dispatch: AppDispatch;
    useSelector: ReturnType<typeof createUseSelector>;
    remoteTasks: Readable<RemoteTask[]>;
    taskUpdateTrigger: Readable<unknown>;
    listProps: Readable<PathToListProps>;
    dataviewLoaded: Readable<boolean>;
    pointerDateTime: Writable<PointerDateTime>;
    dataviewRefreshSignal: Readable<unknown>;
  }) {
    const {
      dispatch,
      useSelector,
      remoteTasks,
      taskUpdateTrigger,
      listProps,
      dataviewLoaded,
      pointerDateTime,
      dataviewRefreshSignal,
    } = props;

    let currentUndoNotice: Notice | undefined;

    const onUpdate: OnUpdateFn = createUpdateHandler({
      settings: this.settings,
      transactionWriter: this.transactionWriter,
      vaultFacade: this.vaultFacade,
      periodicNotes: this.periodicNotes,
      onEditConfirmed: () => {
        currentUndoNotice?.hide();
        currentUndoNotice = createUndoNotice(this.transactionWriter.undo);
      },
      onEditCanceled: () => {
        new Notice("Edit canceled");

        dispatch(editCanceled());
      },
      getTextInput: () => getTextFromUser(this.app),
      getConfirmationInput: (input) =>
        askForConfirmation({
          ...input,
          app: this.app,
        }),
    });

    const onEditAborted = () => {
      new Notice("Tasks changed externally; edit canceled");
    };

    const { isDarkMode, isOnline, keyDown, isModPressed, layoutReady } =
      createEnvironmentHooks({ workspace: this.app.workspace });

    const debouncedTaskUpdateTrigger = useDebounceWithDelay(
      taskUpdateTrigger,
      keyDown,
      reQueryAfterMillis,
    );

    const dateRanges = useDateRanges();
    const visibleDays = useVisibleDays(dateRanges.ranges);

    const {
      tasksWithActiveClockProps,
      activityHistoryForStatusBar,
      dataviewTasks,
      getDisplayedTasksWithClocksForTimeline,
      tasksWithTimeForToday,
      editContext,
      newlyStartedTasks,
      logSummary,
    } = useTasks({
      onUpdate,
      onEditAborted,
      periodicNotes: this.periodicNotes,
      dataviewFacade: this.dataviewFacade,
      metadataCache: this.app.metadataCache,
      workspaceFacade: this.workspaceFacade,
      isOnline,
      visibleDays,
      layoutReady,
      debouncedTaskUpdateTrigger,
      dataviewChange: dataviewRefreshSignal,
      settingsStore: this.settingsStore,
      currentTime,
      pointerDateTime,
      remoteTasks,
      listProps,
    });

    this.registerInterval(
      window.setInterval(() => {
        dispatch(icalRefreshRequested());

        if (shouldAutoSyncFitbit(this.settings())) {
          this.reSyncFitbit(false).catch((error: unknown) => {
            console.error("Fitbit auto-sync failed", error);
          });
        }
      }, icalRefreshIntervalMillis),
    );

    this.registerEvent(
      this.app.metadataCache.on(
        // @ts-expect-error
        "dataview:metadata-change",
        (eventType: unknown, file: TFile) =>
          dispatch(dataviewChange(file.path)),
      ),
    );

    this.registerDomEvent(window, "blur", editContext.cancelEdit);
    this.registerDomEvent(document, "pointerup", editContext.cancelEdit);

    this.register(
      editContext.cursor.subscribe(({ bodyCursor }) => {
        document.body.style.cursor = bodyCursor;
      }),
    );
    this.register(
      visibleDays.subscribe((days) => {
        dispatch(
          // without the offset, an event right of UTC is going to be displayed as the previous day
          // a visible day in my zone is 2025-04-15, but in UTC it's 2025-04-14T22:00:00, and getDayKey returns 2025-04-14
          visibleDaysUpdated(days.map((it) => it.toISOString(true))),
        );
      }),
    );

    const errorStore = writable<Error | undefined>();

    const destroyStatusBarWidget = mountStatusBarWidget({
      plugin: this,
      errorStore,
      dateRanges,
      tasksWithTimeForToday,
      activityHistoryForStatusBar,
    });

    this.register(destroyStatusBarWidget);

    this.register(
      dataviewTasks.subscribe((value) => dispatch(dataviewTasksUpdated(value))),
    );

    this.register(
      newlyStartedTasks.subscribe((value) =>
        notifyAboutStartedTasks(value, this.settings()),
      ),
    );
    this.addCommand({
      id: "re-sync",
      name: "Re-sync tasks",
      callback: async () => {
        dispatch(icalRefreshRequested());
      },
    });

    this.addCommand({
      id: "jump-to-active-clock",
      name: "Jump to active clock",
      callback: () => {
        const currentTasksWithActiveClockProps = get(tasksWithActiveClockProps);

        if (currentTasksWithActiveClockProps.length === 0) {
          new Notice("No active clocks found");

          return;
        }

        const firstTaskWithActiveClockProp =
          currentTasksWithActiveClockProps[0];

        const { location } = firstTaskWithActiveClockProp;

        isNotVoid(location);

        this.workspaceFacade.revealLineInFile(
          location.path,
          location.position?.start?.line,
        );
      },
    });

    if (envMode === "development") {
      this.addCommand({
        id: "dump-metadata",
        name: "Dump metadata to files",
        callback: createDumpMetadataCommand(this.app),
      });
    }

    const defaultObsidianContext: ObsidianContext = {
      app: this.app,
      periodicNotes: this.periodicNotes,
      plannerData: this.plannerData,
      sTaskEditor: this.sTaskEditor,
      workspaceFacade: this.workspaceFacade,
      initWeeklyView: this.initWeeklyLeaf,
      refreshDataviewFn: this.dataviewFacade.getAllTasksFrom,
      dataviewLoaded,
      renderMarkdown: createRenderMarkdown(this.app),
      toggleCheckboxInFile: this.vaultFacade.toggleCheckboxInFile,
      editContext,
      showPreview: createShowPreview(this.app),
      isModPressed,
      reSync: () => dispatch(icalRefreshRequested()),
      reSyncFitbit: () => {
        void this.reSyncFitbit();
      },
      isOnline,
      isDarkMode,
      settings,
      settingsSignal: fromStore(settings),
      pointerDateTime,
      tasksWithActiveClockProps,
      logSummary,
      getDisplayedTasksWithClocksForTimeline,
      dispatch,
      useSelector,
      getAllActivities: () => this.api.getAllActivities(),
      startActivityWithSelection: this.startActivityWithSelection,
    };

    const componentContext = new Map<
      string,
      ObsidianContext | typeof errorStore
    >([
      [obsidianContextKey, defaultObsidianContext],
      [errorContextKey, errorStore],
    ]);

    this.registerView(
      viewTypeTimeline,
      (leaf: WorkspaceLeaf) =>
        new TimelineView(
          leaf,
          this.settings,
          componentContext,
          dateRanges,
          this.periodicNotes,
        ),
    );

    this.registerView(
      viewTypeMultiDay,
      (leaf: WorkspaceLeaf) =>
        new MultiDayView(
          leaf,
          this.settingsStore,
          componentContext,
          dateRanges,
        ),
    );

    this.registerView(
      viewTypeMonthlyCalendar,
      (leaf: WorkspaceLeaf) => new MonthlyView(leaf, componentContext),
    );

    this.registerView(
      viewTypeReleaseNotes,
      (leaf: WorkspaceLeaf) => new DayPlannerReleaseNotesView(leaf),
    );

    this.registerView(
      viewTypeLogSummary,
      (leaf: WorkspaceLeaf) => new LogSummaryView(leaf, componentContext),
    );

    this.registerView(
      viewTypeActivityQueue,
      (leaf: WorkspaceLeaf) => new ActivityQueueView(leaf, componentContext),
    );
  }
}
