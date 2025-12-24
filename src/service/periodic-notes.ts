import type { Moment } from "moment";
import { normalizePath, type TFile } from "obsidian";
import {
  getAllDailyNotes,
  getDailyNote,
  getDateFromPath,
  createDailyNote,
  getDateFromFile,
  DEFAULT_DAILY_NOTE_FORMAT,
  getDailyNoteSettings,

  // ✅ weekly
  appHasWeeklyNotesPluginLoaded,
  getAllWeeklyNotes,
  getWeeklyNote,
  createWeeklyNote,
} from "obsidian-daily-notes-interface";

export class PeriodicNotes {
  readonly DEFAULT_DAILY_NOTE_FORMAT = DEFAULT_DAILY_NOTE_FORMAT;

  hasWeeklyNotesSupport() {
    return appHasWeeklyNotesPluginLoaded();
  }

  getDailyNote(day: Moment, dailyNotes: Record<string, TFile>): TFile | null {
    return getDailyNote(day, dailyNotes) ?? null;
  }

  getAllDailyNotes() {
    return getAllDailyNotes();
  }

  createDailyNote(day: Moment) {
    return createDailyNote(day);
  }

  getWeeklyNote(dayInWeek: Moment): TFile | null {
    if (!appHasWeeklyNotesPluginLoaded()) return null;

    try {
      const weeklyNotes = getAllWeeklyNotes();
      return getWeeklyNote(dayInWeek, weeklyNotes) ?? null;
    } catch {
      return null;
    }
  }

  createWeeklyNote(dayInWeek: Moment) {
    if (!appHasWeeklyNotesPluginLoaded()) return null;

    // Calendar plugin passes a start-of-week-ish date; using startOf("week")
    // keeps behavior consistent with the user’s locale/settings.
    const startOfWeek = dayInWeek.clone().startOf("week");
    return createWeeklyNote(startOfWeek);
  }

  async createWeeklyNoteIfNeeded(week: Moment) {
    return this.getWeeklyNote(week) ?? (await this.createWeeklyNote(week));
  }

  getDateFromPath(path: string, type: "day" | "month" | "year") {
    return getDateFromPath(path, type);
  }

  getDateFromFile(file: TFile, type: "day" | "month" | "year") {
    return getDateFromFile(file, type);
  }

  getDailyNoteSettings() {
    return getDailyNoteSettings();
  }

  createDailyNoteIfNeeded(moment: Moment) {
    return (
      this.getDailyNote(moment, this.getAllDailyNotes()) ||
      this.createDailyNote(moment)
    );
  }

  createDailyNotePath(date: Moment) {
    const { format = this.DEFAULT_DAILY_NOTE_FORMAT, folder = "." } =
      this.getDailyNoteSettings();

    let filename = date.format(format);
    if (!filename.endsWith(".md")) filename += ".md";

    return normalizePath(join(folder, filename));
  }
}

// Copied from obsidian-daily-notes-interface
function join(...partSegments: string[]) {
  let parts: string[] = [];
  for (let i = 0, l = partSegments.length; i < l; i++) {
    parts = parts.concat(partSegments[i].split("/"));
  }
  const newParts: string[] = [];
  for (let i = 0, l = parts.length; i < l; i++) {
    const part = parts[i];
    if (!part || part === ".") continue;
    else newParts.push(part);
  }
  if (parts[0] === "") newParts.unshift("");
  return newParts.join("/");
}
