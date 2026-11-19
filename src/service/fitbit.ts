import { Notice, requestUrl, type RequestUrlParam, type Vault } from "obsidian";
import { z } from "zod";

import type { DayPlannerSettings } from "../settings";

const fitbitAuthUrl = "https://www.fitbit.com/oauth2/authorize";
const fitbitTokenUrl = "https://api.fitbit.com/oauth2/token";
const fitbitApiBaseUrl = "https://api.fitbit.com";

const fitbitScopes = ["activity", "heartrate", "sleep", "profile"];
const fitbitDataDirectory = "_Data/Fitbit";
const fitbitIntradayDirectory = `${fitbitDataDirectory}/intraday`;
const fitbitSyncFrequencyMillis = 60 * 60 * 1000;
const oauthRedirectUri = "https://localhost";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
};

type FitbitProfileResponse = {
  user?: {
    memberSince?: string;
  };
};

const minuteDataset = z.object({
  dataset: z.array(z.object({ time: z.string(), value: z.number() })),
  datasetInterval: z.literal(1),
  datasetType: z.literal("minute"),
});

const heartRateResponse = z.object({
  "activities-heart-intraday": minuteDataset,
});
const stepsResponse = z.object({ "activities-steps-intraday": minuteDataset });

type TokenRequestHeaders = {
  Accept: string;
  Authorization?: string;
};

export class FitbitError extends Error {}

async function requestFitbit(options: RequestUrlParam): Promise<unknown> {
  const response = await requestUrl({ ...options, throw: false });
  if (response.status === 410) {
    throw new FitbitError(
      "Google retired the Fitbit Web API. Linking and sync require migration to the Google Health API.",
    );
  }
  if (response.status >= 400) {
    throw new FitbitError(`Fitbit request failed (HTTP ${response.status}).`);
  }
  return response.json;
}

export function createTokenHeaders(
  clientId: string,
  clientSecret: string,
): TokenRequestHeaders {
  const headers: TokenRequestHeaders = { Accept: "application/json" };

  if (!clientSecret.trim()) {
    return headers;
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  return {
    ...headers,
    Authorization: `Basic ${credentials}`,
  };
}

function toBase64Url(bytes: Uint8Array) {
  const base64 = btoa(String.fromCharCode(...bytes));

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  return toBase64Url(bytes);
}

async function sha256AsBase64Url(value: string) {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);

  return toBase64Url(new Uint8Array(hash));
}

function toIsoDate(input: Date) {
  return input.toISOString().slice(0, 10);
}

function parseDateOrUndefined(value: string) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function addDays(input: Date, days: number) {
  const next = new Date(input);

  next.setUTCDate(next.getUTCDate() + days);

  return next;
}

function listDatesInclusive(start: Date, end: Date) {
  const dates: string[] = [];

  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = addDays(cursor, 1)
  ) {
    dates.push(toIsoDate(cursor));
  }

  return dates;
}

export function getFitbitDatesToSync(props: {
  lastDateSynced: string;
  memberSince: string;
  now?: Date;
}) {
  const now = props.now || new Date();
  const today = parseDateOrUndefined(toIsoDate(now));

  if (!today) {
    return [];
  }

  const memberSinceDate = parseDateOrUndefined(props.memberSince) || today;
  const lastDateSynced = parseDateOrUndefined(props.lastDateSynced);

  const startDate = lastDateSynced
    ? addDays(lastDateSynced, 1)
    : memberSinceDate;

  if (startDate > today) {
    return [toIsoDate(today)];
  }

  return listDatesInclusive(startDate, today);
}

export async function createFitbitAuthorizationUrl(props: {
  clientId: string;
  codeVerifier: string;
}) {
  const { clientId, codeVerifier } = props;
  const challenge = await sha256AsBase64Url(codeVerifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: fitbitScopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: oauthRedirectUri,
  });

  return `${fitbitAuthUrl}?${params.toString()}`;
}

async function exchangeCodeForTokens(props: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
}) {
  const { clientId, clientSecret, code, codeVerifier } = props;

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthRedirectUri,
    code_verifier: codeVerifier,
  });

  const response = await requestFitbit({
    url: fitbitTokenUrl,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
    headers: createTokenHeaders(clientId, clientSecret),
  });

  return response as TokenResponse;
}

async function refreshTokens(props: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const body = new URLSearchParams({
    client_id: props.clientId,
    grant_type: "refresh_token",
    refresh_token: props.refreshToken,
  });

  const response = await requestFitbit({
    url: fitbitTokenUrl,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
    headers: createTokenHeaders(props.clientId, props.clientSecret),
  });

  return response as TokenResponse;
}

function tokenSettings(token: TokenResponse) {
  return {
    fitbitAccessToken: token.access_token,
    fitbitRefreshToken: token.refresh_token,
    fitbitTokenExpiresAt: Date.now() + token.expires_in * 1000,
    fitbitUserId: token.user_id,
  };
}

async function ensureDirectory(vault: Vault, path: string) {
  if (await vault.adapter.exists(path)) {
    return;
  }

  const parentPath = path.split("/").slice(0, -1).join("/");

  if (parentPath.length > 0) {
    await ensureDirectory(vault, parentPath);
  }

  await vault.adapter.mkdir(path);
}

async function writeJson(vault: Vault, relativePath: string, data: unknown) {
  await vault.adapter.write(relativePath, JSON.stringify(data, null, 2));
}

function fetchFitbitJson(accessToken: string, endpoint: string) {
  return requestFitbit({
    url: `${fitbitApiBaseUrl}${endpoint}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
}

async function fetchIntradayForDate(props: {
  accessToken: string;
  date: string;
}) {
  const { accessToken, date } = props;

  const [heartRate, steps] = await Promise.all([
    fetchFitbitJson(
      accessToken,
      `/1/user/-/activities/heart/date/${date}/1d/1min.json`,
    ),
    fetchFitbitJson(
      accessToken,
      `/1/user/-/activities/steps/date/${date}/1d/1min.json`,
    ),
  ]);

  if (!heartRateResponse.safeParse(heartRate).success) {
    throw new FitbitError(
      `Fitbit did not return one-minute heart rate data for ${date}.`,
    );
  }
  if (!stepsResponse.safeParse(steps).success) {
    throw new FitbitError(
      `Fitbit did not return one-minute steps data for ${date}.`,
    );
  }

  return { date, timeStep: "1min", heartRate, steps };
}

export function generateCodeVerifier() {
  return randomBase64Url(64);
}

export function shouldAutoSyncFitbit(
  settings: DayPlannerSettings,
  now = Date.now(),
) {
  if (!settings.fitbitAccessToken || !settings.fitbitRefreshToken) {
    return false;
  }

  return now - settings.fitbitLastSyncAt > fitbitSyncFrequencyMillis;
}

export async function completeFitbitLinking(props: {
  code: string;
  settings: DayPlannerSettings;
}) {
  const { code, settings } = props;

  if (!settings.fitbitClientId || !settings.fitbitCodeVerifier) {
    throw new Error(
      "Set Fitbit client ID and start linking before pasting an auth code.",
    );
  }

  const token = await exchangeCodeForTokens({
    clientId: settings.fitbitClientId,
    clientSecret: settings.fitbitClientSecret,
    code,
    codeVerifier: settings.fitbitCodeVerifier,
  });

  return {
    ...tokenSettings(token),
    fitbitCodeVerifier: "",
  };
}

export async function syncFitbitData(props: {
  vault: Vault;
  settings: DayPlannerSettings;
  onTokenRefresh: (patch: ReturnType<typeof tokenSettings>) => void;
  force?: boolean;
}) {
  const { vault, settings, onTokenRefresh, force = false } = props;

  if (!settings.fitbitClientId || !settings.fitbitRefreshToken) {
    return undefined;
  }

  if (!force && !shouldAutoSyncFitbit(settings)) {
    return undefined;
  }

  const hasExpiredToken =
    !settings.fitbitAccessToken ||
    Date.now() >= settings.fitbitTokenExpiresAt - 30_000;
  let accessToken = settings.fitbitAccessToken;
  if (hasExpiredToken) {
    const token = await refreshTokens({
      clientId: settings.fitbitClientId,
      clientSecret: settings.fitbitClientSecret,
      refreshToken: settings.fitbitRefreshToken,
    });
    onTokenRefresh(tokenSettings(token));
    accessToken = token.access_token;
  }

  const [profile, sleepToday] = await Promise.all([
    fetchFitbitJson(accessToken, "/1/user/-/profile.json"),
    fetchFitbitJson(accessToken, "/1.2/user/-/sleep/date/today.json"),
  ]);

  const profileJson = profile as FitbitProfileResponse;
  const memberSince = profileJson.user?.memberSince || toIsoDate(new Date());
  const datesToSync = getFitbitDatesToSync({
    lastDateSynced: settings.fitbitLastDateSynced,
    memberSince,
  });

  await ensureDirectory(vault, fitbitIntradayDirectory);
  const syncedDates: string[] = [];

  for (const date of datesToSync) {
    const intraday = await fetchIntradayForDate({ accessToken, date });

    await writeJson(vault, `${fitbitIntradayDirectory}/${date}.json`, intraday);
    syncedDates.push(date);
  }

  const latestSyncedDate = syncedDates.at(-1) || settings.fitbitLastDateSynced;
  const syncedAt = new Date().toISOString();

  await Promise.all([
    writeJson(vault, `${fitbitDataDirectory}/profile.json`, profileJson),
    writeJson(vault, `${fitbitDataDirectory}/sleep-today.json`, sleepToday),
    writeJson(vault, `${fitbitDataDirectory}/last-sync.json`, {
      syncedAt,
      memberSince,
      latestSyncedDate,
      syncedDates,
      timeStep: "1min",
    }),
  ]);

  return {
    fitbitLastSyncAt: Date.now(),
    fitbitLastDateSynced: latestSyncedDate,
  };
}

export async function startFitbitAuthorization(props: {
  settings: DayPlannerSettings;
  onSettingsUpdate: (patch: Partial<DayPlannerSettings>) => void;
}) {
  const { settings, onSettingsUpdate } = props;

  if (!settings.fitbitClientId.trim() || !settings.fitbitClientSecret.trim()) {
    new Notice("Add your Fitbit client ID and client secret first.");

    return;
  }

  const codeVerifier = generateCodeVerifier();
  const authUrl = await createFitbitAuthorizationUrl({
    clientId: settings.fitbitClientId,
    codeVerifier,
  });

  onSettingsUpdate({ fitbitCodeVerifier: codeVerifier });
  window.open(authUrl, "_blank");
  new Notice("Authorize in Fitbit, then paste the returned code in settings.");
}
