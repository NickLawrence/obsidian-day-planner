import { describe, expect, test } from "vitest";

import {
  createTokenHeaders,
  getFitbitDatesToSync,
} from "../src/service/fitbit";

describe("getFitbitDatesToSync", () => {
  test("returns full range for first sync", () => {
    const dates = getFitbitDatesToSync({
      memberSince: "2026-01-01",
      lastDateSynced: "",
      now: new Date("2026-01-03T12:00:00.000Z"),
    });

    expect(dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  test("returns only new dates after last synced day", () => {
    const dates = getFitbitDatesToSync({
      memberSince: "2026-01-01",
      lastDateSynced: "2026-01-02",
      now: new Date("2026-01-03T12:00:00.000Z"),
    });

    expect(dates).toEqual(["2026-01-03"]);
  });

  test("keeps refreshing today when already caught up", () => {
    const dates = getFitbitDatesToSync({
      memberSince: "2026-01-01",
      lastDateSynced: "2026-01-03",
      now: new Date("2026-01-03T12:00:00.000Z"),
    });

    expect(dates).toEqual(["2026-01-03"]);
  });
});

describe("createTokenHeaders", () => {
  test("includes basic auth header when secret exists", () => {
    const headers = createTokenHeaders("client", "secret");

    expect(headers.Authorization).toBe("Basic Y2xpZW50OnNlY3JldA==");
  });

  test("omits authorization header when secret is missing", () => {
    const headers = createTokenHeaders("client", "");

    expect(headers).toEqual({ Accept: "application/json" });
  });
});
