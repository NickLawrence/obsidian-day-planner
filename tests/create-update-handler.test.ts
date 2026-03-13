import { describe, expect, it } from "vitest";

import { getActivitySuggestionsWithHistory } from "../src/create-update-handler";
import type { Activity } from "../src/util/props";

function createActivity(activity: string, details: Record<string, unknown>): Activity {
  return {
    activity,
    taskIds: [],
    log: [],
    ...details,
  };
}

describe("getActivitySuggestionsWithHistory", () => {
  it("returns raw and historical mainKey suggestions for game", () => {
    const suggestions = getActivitySuggestionsWithHistory([
      createActivity("game", { game: { name: "Skyrim" } }),
      createActivity("game", { game: { name: "Civ VI" } }),
    ]);

    const gameSuggestions = suggestions.filter(
      ({ activityName }) => activityName === "game",
    );

    expect(gameSuggestions.map(({ displayText }) => displayText)).toEqual([
      "🎮 Game",
      "🎮 Game - Civ VI",
      "🎮 Game - Skyrim",
    ]);
  });

  it("skips mainKey history suggestions when suggestHistory is false", () => {
    const suggestions = getActivitySuggestionsWithHistory([
      createActivity("movie", { movie: { name: "Dune" } }),
      createActivity("movie", { movie: { name: "Arrival" } }),
    ]);

    const movieSuggestions = suggestions.filter(
      ({ activityName }) => activityName === "movie",
    );

    expect(movieSuggestions.map(({ displayText }) => displayText)).toEqual([
      "📺 Movie",
    ]);
  });

  it("adds next range start value for read suggestions", () => {
    const suggestions = getActivitySuggestionsWithHistory([
      createActivity("read", {
        read: { book: "War and Peace", "start-page": 90, "end-page": 104 },
      }),
    ]);

    const readSuggestion = suggestions.find(
      ({ displayText }) => displayText === "📖 Read - War and Peace - Start page: 105",
    );

    expect(readSuggestion?.initialValues).toEqual({
      book: "War and Peace",
      "start-page": 105,
    });
  });

  it("uses the most recent range end value when suggesting next start", () => {
    const suggestions = getActivitySuggestionsWithHistory([
      createActivity("read", {
        log: [{ start: "2025-01-03T08:00:00.000Z", end: "2025-01-03T09:00:00.000Z" }],
        read: { book: "War and Peace", "start-page": 200, "end-page": 220 },
      }),
      createActivity("read", {
        log: [{ start: "2025-01-01T08:00:00.000Z", end: "2025-01-01T09:00:00.000Z" }],
        read: { book: "War and Peace", "start-page": 90, "end-page": 104 },
      }),
    ]);

    const readSuggestion = suggestions.find(
      ({ displayText }) =>
        displayText === "📖 Read - War and Peace - Start page: 221",
    );

    expect(readSuggestion?.initialValues).toEqual({
      book: "War and Peace",
      "start-page": 221,
    });
  });

});
