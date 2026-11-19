import { createHash, webcrypto } from "node:crypto";
import { createServer } from "node:http";

import { DateTime } from "luxon";
import { requestUrl, type RequestUrlParam, type Vault } from "obsidian";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  googleHealthScopes,
  linkGoogleHealth,
  syncGoogleHealthData,
  type GoogleHealthConnection,
} from "../src/service/google-health";
import { getGoogleAuthorizationCode } from "../src/service/google-health-oauth";
import { loadPluginData } from "../src/settings";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function response(json: unknown, status = 200) {
  return {
    json,
    status,
    headers: {},
    text: "",
    arrayBuffer: new ArrayBuffer(0),
  };
}

const client = { clientId: "desktop-client", clientSecret: "client-secret" };
const token = {
  access_token: "new-access",
  refresh_token: "new-refresh",
  expires_in: 3600,
  scope: googleHealthScopes.join(" "),
};
const authorization = {
  code: "single-use-code",
  codeVerifier: "verifier",
  redirectUri: "http://127.0.0.1:12345",
};

describe("Google OAuth", () => {
  test("accepts the state-bound loopback callback and sends an S256 challenge", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const openBrowser = vi.fn(async (url: string) => {
      const login = new URL(url);
      const redirect = new URL(login.searchParams.get("redirect_uri")!);
      expect(login.origin).toBe("https://accounts.google.com");
      expect(redirect.hostname).toBe("127.0.0.1");
      redirect.searchParams.set("code", "single-use-code");
      redirect.searchParams.set("state", "unexpected-state");
      expect((await fetch(redirect)).status).toBe(400);
      redirect.searchParams.set("state", login.searchParams.get("state")!);
      expect((await fetch(redirect)).status).toBe(200);
    });

    const result = await getGoogleAuthorizationCode(
      client.clientId,
      new AbortController().signal,
      openBrowser,
      createServer,
    );
    await openBrowser.mock.results[0].value;
    const login = new URL(openBrowser.mock.calls[0][0]);
    expect(login.searchParams.get("access_type")).toBe("offline");
    expect(login.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(result.codeVerifier).digest("base64url"),
    );
    expect(result.code).toBe("single-use-code");
  });

  test("exchanges the code and verifies the Google Health identity", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(response(token))
      .mockResolvedValueOnce(
        response({ healthUserId: "health-123", legacyUserId: "AB1234" }),
      );

    await expect(
      linkGoogleHealth(client, authorization),
    ).resolves.toMatchObject({
      userId: "health-123",
      refreshToken: token.refresh_token,
    });
    const request = vi.mocked(requestUrl).mock.calls[0][0] as RequestUrlParam;
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    expect(
      Object.fromEntries(new URLSearchParams(request.body as string)),
    ).toMatchObject({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: authorization.codeVerifier,
      redirect_uri: authorization.redirectUri,
    });
    expect(requestUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "https://health.googleapis.com/v4/users/me/identity",
        headers: expect.objectContaining({
          Authorization: "Bearer new-access",
        }),
      }),
    );
  });

  test("rejects partial consent before checking identity", async () => {
    const granted = googleHealthScopes.filter(
      (scope) => !scope.includes(".sleep."),
    );
    vi.mocked(requestUrl).mockResolvedValueOnce(
      response({ ...token, scope: granted.join(" ") }),
    );

    await expect(linkGoogleHealth(client, authorization)).rejects.toThrow(
      "allow Google Health access to sleep",
    );
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });

  test("explains when the Google Account has no Google Health profile", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(response(token))
      .mockResolvedValueOnce(
        response(
          { error: { details: [{ reason: "ACCOUNT_NOT_LINKED" }] } },
          400,
        ),
      );

    await expect(linkGoogleHealth(client, authorization)).rejects.toThrow(
      "Sign into the Google Health mobile app",
    );
  });
});

const now = DateTime.fromISO("2026-11-01T12:30", {
  zone: "America/Los_Angeles",
});
const connection: GoogleHealthConnection = {
  ...client,
  accessToken: "initial-access",
  refreshToken: "initial-refresh",
  expiresAt: Date.now() + 3_600_000,
  userId: "health-123",
  lastSyncAt: 0,
  lastCompletedDate: "",
};
const directory = "_Data/GoogleHealth/health-123";

function setupSync() {
  const files = new Map<string, unknown>([
    ["_Data/Fitbit/intraday/2026-11-01.json", "legacy"],
  ]);
  const folders = new Set(["_Data", "_Data/Fitbit", "_Data/Fitbit/intraday"]);
  const assertParent = (path: string) => {
    const slash = path.lastIndexOf("/");
    if (slash !== -1 && !folders.has(path.slice(0, slash))) {
      throw new Error(`Missing parent of ${path}`);
    }
  };
  const vault = {
    adapter: {
      exists: async (path: string) => folders.has(path),
      mkdir: async (path: string) => {
        assertParent(path);
        folders.add(path);
      },
      write: async (path: string, data: string) => {
        assertParent(path);
        files.set(path, JSON.parse(data));
      },
    },
  } as unknown as Vault;
  return { files, vault, onProgress: vi.fn() };
}

function mockRequests(
  handler: (request: RequestUrlParam) => ReturnType<typeof response>,
) {
  vi.mocked(requestUrl).mockImplementation(
    (request) =>
      Promise.resolve(handler(request as RequestUrlParam)) as ReturnType<
        typeof requestUrl
      >,
  );
}

describe("Google Health exports", () => {
  test("exports paginated one-minute data across a 25-hour day and keeps legacy files", async () => {
    const { vault, files, onProgress } = setupSync();
    const first = {
      startTime: "2026-11-01T07:00:00Z",
      endTime: "2026-11-01T07:01:00Z",
    };
    const second = {
      startTime: first.endTime,
      endTime: "2026-11-01T07:02:00Z",
    };
    const sleep = {
      sleep: {
        interval: {
          startTime: "2026-11-01T03:00:00Z",
          endTime: "2026-11-01T14:00:00Z",
        },
        summary: { minutesAsleep: "600" },
      },
    };
    mockRequests(({ url, body }) => {
      if (url.endsWith("/profile"))
        return response({ name: "users/me/profile" });
      if (url.includes("/sleep/")) {
        const filter = new URL(url).searchParams.get("filter");
        expect(filter).toBe(
          'sleep.interval.end_time >= "2026-11-01T07:00:00.000Z" AND sleep.interval.end_time < "2026-11-02T08:00:00.000Z"',
        );
        return response({ dataPoints: [sleep] });
      }
      const request = JSON.parse(body as string);
      expect(request).toMatchObject({
        windowSize: "60s",
        range: {
          startTime: "2026-11-01T07:00:00.000Z",
          endTime: "2026-11-02T08:00:00.000Z",
        },
      });
      if (url.includes("/steps/")) {
        return request.pageToken === "more-steps"
          ? response({ rollupDataPoints: [second] })
          : response({
              rollupDataPoints: [{ ...first, steps: { countSum: "0" } }],
              nextPageToken: "more-steps",
            });
      }
      expect(url).toContain("/heart-rate/");
      return response({
        rollupDataPoints: [
          { ...first, heartRate: { beatsPerMinuteAvg: 64.5 } },
        ],
      });
    });

    await syncGoogleHealthData({
      vault,
      connection,
      onProgress,
      signal: new AbortController().signal,
      now,
    });

    expect(files.get(`${directory}/intraday/2026-11-01.json`)).toEqual({
      date: "2026-11-01",
      timeZone: "America/Los_Angeles",
      timeStep: "1min",
      steps: [
        { ...first, count: 0 },
        { ...second, count: null },
      ],
      heartRate: [{ ...first, averageBpm: 64.5 }],
    });
    expect(files.get(`${directory}/sleep-today.json`)).toMatchObject({
      dataPoints: [sleep],
    });
    expect(files.get("_Data/Fitbit/intraday/2026-11-01.json")).toBe("legacy");
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastCompletedDate: "",
        lastSyncAt: expect.any(Number),
      }),
    );
  });

  test("does not write a daily summary in place of one-minute results", async () => {
    const { vault, files, onProgress } = setupSync();
    mockRequests(({ url }) => {
      if (url.endsWith("/profile"))
        return response({ name: "users/me/profile" });
      if (url.includes("/steps/")) return response({ dataPoints: [] });
      return response({});
    });

    await expect(
      syncGoogleHealthData({
        vault,
        connection,
        onProgress,
        signal: new AbortController().signal,
        now,
      }),
    ).rejects.toThrow("invalid steps response");
    expect(onProgress).not.toHaveBeenCalled();
    expect(files.has(`${directory}/intraday/2026-11-01.json`)).toBe(false);
  });

  test("saves a refreshed token and advances the checkpoint only for written days", async () => {
    const { vault, files, onProgress } = setupSync();
    mockRequests(({ url, body, headers }) => {
      if (url === "https://oauth2.googleapis.com/token") {
        expect(new URLSearchParams(body as string).get("refresh_token")).toBe(
          connection.refreshToken,
        );
        return response({
          access_token: token.access_token,
          expires_in: token.expires_in,
        });
      }
      expect(headers?.Authorization).toBe("Bearer new-access");
      if (url.endsWith("/profile")) {
        return response({
          name: "users/me/profile",
          membershipStartDate: { year: 2026, month: 10, day: 30 },
        });
      }
      if (url.includes("/sleep/")) return response({});
      if (JSON.parse(body as string).range.startTime.startsWith("2026-10-31")) {
        return response({}, 429);
      }
      return response({});
    });

    await expect(
      syncGoogleHealthData({
        vault,
        connection: { ...connection, expiresAt: 0 },
        onProgress,
        signal: new AbortController().signal,
        now,
      }),
    ).rejects.toThrow("limited sync requests");
    expect(onProgress.mock.calls).toEqual([
      [
        expect.objectContaining({
          accessToken: token.access_token,
          refreshToken: connection.refreshToken,
          lastCompletedDate: "",
        }),
      ],
      [
        expect.objectContaining({
          accessToken: token.access_token,
          lastCompletedDate: "2026-10-30",
        }),
      ],
    ]);
    expect(files.has(`${directory}/intraday/2026-10-30.json`)).toBe(true);
    expect(files.has(`${directory}/intraday/2026-10-31.json`)).toBe(false);
    expect(files.has(`${directory}/last-sync.json`)).toBe(false);
  });
});

test("removes retired Fitbit credentials and checkpoints from vault settings", () => {
  const settings = loadPluginData({
    showNext: false,
    fitbitClientId: "old-client",
    fitbitClientSecret: "old-secret",
    fitbitRefreshToken: "old-refresh",
    fitbitLastDateSynced: "2026-11-01",
  });
  expect(settings.showNext).toBe(false);
  expect(Object.keys(settings).some((key) => key.startsWith("fitbit"))).toBe(
    false,
  );
});
