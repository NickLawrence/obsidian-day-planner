import { DateTime } from "luxon";
import { requestUrl, type RequestUrlParam, type Vault } from "obsidian";
import { z } from "zod";

const healthApi = "https://health.googleapis.com/v4/users/me";
const tokenUrl = "https://oauth2.googleapis.com/token";
const dataDirectory = "_Data/GoogleHealth";
const syncIntervalMillis = 60 * 60 * 1000;
const maxBackfillDaysPerSync = 30;

const scopeNames = {
  activity_and_fitness: "steps",
  health_metrics_and_measurements: "heart rate",
  sleep: "sleep",
  profile: "profile",
};
const readonlyScope = (name: string) =>
  `https://www.googleapis.com/auth/googlehealth.${name}.readonly`;
export const googleHealthScopes = Object.keys(scopeNames).map(readonlyScope);

export class GoogleHealthError extends Error {}

const tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});

const credentials = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type GoogleHealthCredentials = z.infer<typeof credentials>;

const healthUserId = z.string().regex(/^[A-Za-z0-9-]{1,63}$/);
const identity = z.object({ healthUserId });

export const googleHealthConnectionSchema = credentials.extend({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  userId: healthUserId,
  lastSyncAt: z.number(),
  lastCompletedDate: z.union([z.literal(""), z.iso.date()]),
});
export type GoogleHealthConnection = z.infer<
  typeof googleHealthConnectionSchema
>;

const errorResponse = z.object({
  error: z.union([
    z.string(),
    z.object({
      details: z.array(z.object({ reason: z.string().optional() })).optional(),
    }),
  ]),
});
const profileSchema = z.looseObject({
  name: z.string().min(1),
  membershipStartDate: z
    .object({
      year: z.number().int().optional(),
      month: z.number().int().optional(),
      day: z.number().int().optional(),
    })
    .optional(),
});

const timestamp = z.iso.datetime({ offset: true });
const rollupWindow = z.object({ startTime: timestamp, endTime: timestamp });
const stepsWindow = rollupWindow.extend({
  steps: z
    .object({
      countSum: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().nonnegative()),
    })
    .optional(),
});
const heartRateWindow = rollupWindow.extend({
  heartRate: z.object({ beatsPerMinuteAvg: z.number().positive() }).optional(),
});
const sleepPoint = z.looseObject({
  sleep: z.looseObject({
    interval: z.looseObject({ startTime: timestamp, endTime: timestamp }),
  }),
});

function parseResponse<T>(schema: z.ZodType<T>, json: unknown, label: string) {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GoogleHealthError(
      `Google Health returned an invalid ${label} response.`,
    );
  }
  return parsed.data;
}

async function requestGoogle(options: RequestUrlParam, label: string) {
  let status: number;
  let json: unknown;
  try {
    const response = await requestUrl({ ...options, throw: false });
    status = response.status;
    if (status >= 200 && status < 300) {
      return response.json as unknown;
    }
    try {
      json = response.json;
    } catch {
      // HTTP errors can have a non-JSON body.
    }
  } catch {
    throw new GoogleHealthError(
      `Could not read the Google Health ${label} response.`,
    );
  }

  const apiError = errorResponse.safeParse(json).data?.error;
  if (
    typeof apiError === "object" &&
    apiError.details?.some(({ reason }) => reason === "ACCOUNT_NOT_LINKED")
  ) {
    throw new GoogleHealthError(
      "Sign into the Google Health mobile app with this Google Account, then connect again here.",
    );
  }
  if (apiError === "invalid_client") {
    throw new GoogleHealthError(
      "Google rejected the OAuth client. Check the Desktop app client ID and secret.",
    );
  }
  if (apiError === "invalid_grant" || status === 401) {
    throw new GoogleHealthError(
      "Google Health authorization has expired. Reconnect your account.",
    );
  }
  if (status === 403) {
    throw new GoogleHealthError(
      "Google Health denied access. Check that the API is enabled and this account can use the OAuth client.",
    );
  }
  if (status === 429) {
    throw new GoogleHealthError(
      "Google Health limited sync requests. Try again later.",
    );
  }
  throw new GoogleHealthError(
    `Google Health ${label} request failed (HTTP ${status}).`,
  );
}

function requestHealth(
  accessToken: string,
  path: string,
  label: string,
  body?: object,
) {
  return requestGoogle(
    {
      url: `${healthApi}/${path}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      ...(body && {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(body),
      }),
    },
    label,
  );
}

async function exchangeToken(
  client: GoogleHealthCredentials,
  params: Record<string, string>,
) {
  const json = await requestGoogle(
    {
      url: tokenUrl,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        ...params,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }).toString(),
    },
    "OAuth token",
  );
  return parseResponse(tokens, json, "OAuth token");
}

export async function linkGoogleHealth(
  client: GoogleHealthCredentials,
  authorization: { code: string; codeVerifier: string; redirectUri: string },
): Promise<GoogleHealthConnection> {
  const token = await exchangeToken(client, {
    grant_type: "authorization_code",
    code: authorization.code,
    code_verifier: authorization.codeVerifier,
    redirect_uri: authorization.redirectUri,
  });
  const granted = new Set(token.scope?.split(/\s+/));
  const missing = Object.entries(scopeNames)
    .filter(([name]) => !granted.has(readonlyScope(name)))
    .map(([, label]) => label);
  if (missing.length > 0) {
    throw new GoogleHealthError(
      `Connect again and allow Google Health access to ${missing.join(", ")}.`,
    );
  }
  if (!token.refresh_token) {
    throw new GoogleHealthError(
      "Google did not grant offline access. Reconnect to enable background sync.",
    );
  }

  const expiresAt = Date.now() + token.expires_in * 1000;
  const account = parseResponse(
    identity,
    await requestHealth(token.access_token, "identity", "identity"),
    "identity",
  );
  return {
    ...client,
    userId: account.healthUserId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt,
    lastSyncAt: 0,
    lastCompletedDate: "",
  };
}

export async function revokeGoogleHealth(refreshToken: string) {
  try {
    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/revoke",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ token: refreshToken }).toString(),
      throw: false,
    });
    if (response.status === 200) return;
  } catch {
    // The local connection has already been removed.
  }
  throw new GoogleHealthError(
    "Disconnected on this device. Remove Day Planner access in your Google Account to revoke the grant.",
  );
}

export function shouldSyncGoogleHealth(
  connection: GoogleHealthConnection,
  now = Date.now(),
) {
  return now - connection.lastSyncAt >= syncIntervalMillis;
}

async function refreshConnection(connection: GoogleHealthConnection) {
  const token = await exchangeToken(connection, {
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
  });
  return {
    ...connection,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? connection.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

async function readPages<T>(
  requestPage: (pageToken: string | undefined) => Promise<unknown>,
  schema: z.ZodType<{ points: T[]; nextPageToken?: string }>,
  label: string,
) {
  const points: T[] = [];
  let pageToken: string | undefined;
  const seenTokens = new Set<string>();
  do {
    const page = parseResponse(schema, await requestPage(pageToken), label);
    points.push(...page.points);
    pageToken = page.nextPageToken;
    if (pageToken && seenTokens.has(pageToken)) {
      throw new GoogleHealthError(
        `Google Health repeated a ${label} page token.`,
      );
    }
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);
  return points;
}

const stepsPage = z
  .strictObject({
    rollupDataPoints: z.array(stepsWindow).default([]),
    nextPageToken: z.string().optional(),
  })
  .transform(({ rollupDataPoints: points, nextPageToken }) => ({
    points,
    nextPageToken,
  }));
const heartRatePage = z
  .strictObject({
    rollupDataPoints: z.array(heartRateWindow).default([]),
    nextPageToken: z.string().optional(),
  })
  .transform(({ rollupDataPoints: points, nextPageToken }) => ({
    points,
    nextPageToken,
  }));
const sleepPage = z
  .strictObject({
    dataPoints: z.array(sleepPoint).default([]),
    nextPageToken: z.string().optional(),
  })
  .transform(({ dataPoints: points, nextPageToken }) => ({
    points,
    nextPageToken,
  }));

function dayRange(day: DateTime) {
  return {
    startTime: day.toUTC().toISO()!,
    endTime: day.plus({ days: 1 }).toUTC().toISO()!,
  };
}

async function readIntraday(accessToken: string, day: DateTime) {
  const range = dayRange(day);
  const rollup = (
    type: "steps" | "heart-rate",
    pageToken: string | undefined,
  ) =>
    requestHealth(accessToken, `dataTypes/${type}/dataPoints:rollUp`, type, {
      range,
      windowSize: "60s",
      pageSize: 2000,
      pageToken,
    });

  const [steps, heartRate] = await Promise.all([
    readPages((page) => rollup("steps", page), stepsPage, "steps"),
    readPages(
      (page) => rollup("heart-rate", page),
      heartRatePage,
      "heart rate",
    ),
  ]);
  return {
    date: day.toISODate(),
    timeZone: day.zoneName,
    timeStep: "1min",
    steps: steps.map(({ startTime, endTime, steps }) => ({
      startTime,
      endTime,
      count: steps?.countSum ?? null,
    })),
    heartRate: heartRate.map(({ startTime, endTime, heartRate }) => ({
      startTime,
      endTime,
      averageBpm: heartRate?.beatsPerMinuteAvg ?? null,
    })),
  };
}

async function readSleep(accessToken: string, date: DateTime) {
  const { startTime, endTime } = dayRange(date);
  const filter = `sleep.interval.end_time >= "${startTime}" AND sleep.interval.end_time < "${endTime}"`;
  const dataPoints = await readPages(
    (pageToken) => {
      const query = new URLSearchParams({ filter });
      if (pageToken) query.set("pageToken", pageToken);
      return requestHealth(
        accessToken,
        `dataTypes/sleep/dataPoints:reconcile?${query}`,
        "sleep",
      );
    },
    sleepPage,
    "sleep",
  );
  return { date: date.toISODate(), timeZone: date.zoneName, dataPoints };
}

async function writeJson(vault: Vault, path: string, data: unknown) {
  let folder = "";
  for (const part of path.split("/").slice(0, -1)) {
    folder = folder ? `${folder}/${part}` : part;
    if (!(await vault.adapter.exists(folder))) {
      await vault.adapter.mkdir(folder);
    }
  }
  await vault.adapter.write(path, JSON.stringify(data, null, 2));
}

export async function syncGoogleHealthData({
  vault,
  connection,
  onProgress,
  signal,
  now = DateTime.local(),
}: {
  vault: Vault;
  connection: GoogleHealthConnection;
  onProgress: (connection: GoogleHealthConnection) => void;
  signal: AbortSignal;
  now?: DateTime;
}) {
  signal.throwIfAborted();
  if (Date.now() >= connection.expiresAt - 30_000) {
    connection = await refreshConnection(connection);
    signal.throwIfAborted();
    onProgress(connection);
  }

  const directory = `${dataDirectory}/${connection.userId}`;
  const today = now.startOf("day");
  const { accessToken } = connection;
  const [profile, sleep, intraday] = await Promise.all([
    requestHealth(accessToken, "profile", "profile").then((json) =>
      parseResponse(profileSchema, json, "profile"),
    ),
    readSleep(accessToken, today),
    readIntraday(accessToken, today),
  ]);
  signal.throwIfAborted();

  await writeJson(vault, `${directory}/profile.json`, profile);
  await writeJson(vault, `${directory}/sleep-today.json`, sleep);
  await writeJson(
    vault,
    `${directory}/intraday/${today.toISODate()}.json`,
    intraday,
  );

  const membership = profile.membershipStartDate;
  const memberSince =
    membership?.year && membership.month && membership.day
      ? DateTime.fromObject(
          {
            year: membership.year,
            month: membership.month,
            day: membership.day,
          },
          { zone: today.zone },
        )
      : today;
  let date = connection.lastCompletedDate
    ? DateTime.fromISO(connection.lastCompletedDate, { zone: today.zone }).plus(
        { days: 1 },
      )
    : memberSince;
  for (
    let days = 0;
    date.isValid && date < today && days < maxBackfillDaysPerSync;
    days++, date = date.plus({ days: 1 })
  ) {
    signal.throwIfAborted();
    const historical = await readIntraday(accessToken, date);
    signal.throwIfAborted();
    await writeJson(
      vault,
      `${directory}/intraday/${date.toISODate()}.json`,
      historical,
    );
    connection = { ...connection, lastCompletedDate: date.toISODate()! };
    signal.throwIfAborted();
    onProgress(connection);
  }

  signal.throwIfAborted();
  const lastSyncAt = Date.now();
  await writeJson(vault, `${directory}/last-sync.json`, {
    syncedAt: new Date(lastSyncAt).toISOString(),
    latestDate: today.toISODate(),
    historyThrough: connection.lastCompletedDate || null,
    historyPending: date.isValid && date < today,
    timeStep: "1min",
  });
  signal.throwIfAborted();
  onProgress({ ...connection, lastSyncAt });
}
