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
});
