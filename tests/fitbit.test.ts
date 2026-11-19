import { requestUrl, type Vault } from "obsidian";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createTokenHeaders,
  getFitbitDatesToSync,
  syncFitbitData,
} from "../src/service/fitbit";
import { defaultSettings } from "../src/settings";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

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

describe("syncFitbitData", () => {
  const date = "2026-01-01";
  const now = new Date(`${date}T12:00:00Z`);
  const profile = { user: { memberSince: date } };
  const sleep = { sleep: [] };
  const heartRate = {
    "activities-heart": [{ dateTime: date, value: { restingHeartRate: 60 } }],
    "activities-heart-intraday": {
      dataset: [],
      datasetInterval: 1,
      datasetType: "minute",
    },
  };
  const stepsSummary = { "activities-steps": [{ dateTime: date, value: "0" }] };
  const steps = {
    ...stepsSummary,
    "activities-steps-intraday": {
      dataset: [{ time: "08:00:00", value: 0 }],
      datasetInterval: 1,
      datasetType: "minute",
    },
  };

  function reply(json: unknown, status = 200) {
    vi.mocked(requestUrl).mockResolvedValueOnce({
      status,
      json,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      text: JSON.stringify(json),
    });
  }

  function setupSync() {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const directories = new Set<string>();
    const files = new Map<string, unknown>();
    const parent = (path: string) => path.slice(0, path.lastIndexOf("/"));
    const requireParent = (path: string) => {
      if (path.includes("/") && !directories.has(parent(path))) {
        throw new Error(`Missing parent directory for ${path}`);
      }
    };
    const vault = {
      adapter: {
        exists: async (path: string) => directories.has(path),
        mkdir: async (path: string) => {
          requireParent(path);
          directories.add(path);
        },
        write: async (path: string, data: string) => {
          requireParent(path);
          files.set(path, JSON.parse(data));
        },
      },
    } as unknown as Vault;

    const settings = {
      ...defaultSettings,
      fitbitClientId: "client",
      fitbitAccessToken: "access",
      fitbitRefreshToken: "refresh",
      fitbitTokenExpiresAt: now.getTime() + 3_600_000,
    };
    return {
      files,
      sync: {
        vault,
        settings,
        force: true,
        onTokenRefresh: vi.fn(),
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  test("exports the full intraday responses to a new vault directory", async () => {
    const { files, sync } = setupSync();
    reply(profile);
    reply(sleep);
    reply(heartRate);
    reply(steps);

    await expect(syncFitbitData(sync)).resolves.toMatchObject({
      fitbitLastDateSynced: date,
    });
    expect(files.get(`_Data/Fitbit/intraday/${date}.json`)).toEqual({
      date,
      timeStep: "1min",
      heartRate,
      steps,
    });
    expect(files.get("_Data/Fitbit/profile.json")).toEqual(profile);
    expect(files.get("_Data/Fitbit/sleep-today.json")).toEqual(sleep);
    expect(files.get("_Data/Fitbit/last-sync.json")).toMatchObject({
      latestSyncedDate: date,
    });
  });

  test("reports a summary-only response and preserves refreshed credentials", async () => {
    const { files, sync } = setupSync();
    sync.settings.fitbitTokenExpiresAt = now.getTime();
    reply({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      user_id: "user",
    });
    reply(profile);
    reply(sleep);
    reply(heartRate);
    reply(stepsSummary);

    await expect(syncFitbitData(sync)).rejects.toThrow(
      `Fitbit did not return one-minute steps data for ${date}`,
    );
    expect(sync.onTokenRefresh).toHaveBeenCalledWith({
      fitbitAccessToken: "new-access",
      fitbitRefreshToken: "new-refresh",
      fitbitTokenExpiresAt: now.getTime() + 3_600_000,
      fitbitUserId: "user",
    });
    expect(files.size).toBe(0);
  });

  test("reports that the retired API requires migration on HTTP 410", async () => {
    const { files, sync } = setupSync();
    reply(null, 410);
    reply(sleep);

    await expect(syncFitbitData(sync)).rejects.toThrow("Google Health API");
    expect(files.size).toBe(0);
  });
});
