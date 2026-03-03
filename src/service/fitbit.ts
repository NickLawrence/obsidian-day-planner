import { Notice, requestUrl, type Vault } from "obsidian";

import type { DayPlannerSettings } from "../settings";

const fitbitAuthUrl = "https://www.fitbit.com/oauth2/authorize";
const fitbitTokenUrl = "https://api.fitbit.com/oauth2/token";
const fitbitApiBaseUrl = "https://api.fitbit.com";

const fitbitScopes = ["activity", "heartrate", "sleep", "profile"];
const fitbitDataDirectory = "_Data/Fitbit";
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

type FitbitIntradayResponse = {
  [key: string]: unknown;
};

type TokenRequestHeaders = {
  Accept: string;
  Authorization?: string;
};

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

  const response = await requestUrl({
    url: fitbitTokenUrl,
    method: "POST",
    throw: true,
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
    headers: createTokenHeaders(clientId, clientSecret),
  });

  return response.json as TokenResponse;
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

  const response = await requestUrl({
    url: fitbitTokenUrl,
    method: "POST",
    throw: true,
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
    headers: createTokenHeaders(props.clientId, props.clientSecret),
  });

  return response.json as TokenResponse;
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
  await ensureDirectory(vault, fitbitDataDirectory);
  await vault.adapter.write(relativePath, JSON.stringify(data, null, 2));
}

async function fetchFitbitJson(accessToken: string, endpoint: string) {
  const response = await requestUrl({
    url: `${fitbitApiBaseUrl}${endpoint}`,
    method: "GET",
    throw: true,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  return response.json;
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

  return {
    date,
    timeStep: "1min",
    heartRate: heartRate as FitbitIntradayResponse,
    steps: steps as FitbitIntradayResponse,
  };
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
    fitbitAccessToken: token.access_token,
    fitbitRefreshToken: token.refresh_token,
    fitbitTokenExpiresAt: Date.now() + token.expires_in * 1000,
    fitbitUserId: token.user_id,
    fitbitCodeVerifier: "",
  };
}

export async function syncFitbitData(props: {
  vault: Vault;
  settings: DayPlannerSettings;
  force?: boolean;
}) {
  const { vault, settings, force = false } = props;

  if (!settings.fitbitClientId || !settings.fitbitRefreshToken) {
    return undefined;
  }

  if (!force && !shouldAutoSyncFitbit(settings)) {
    return undefined;
  }

  const hasExpiredToken =
    !settings.fitbitAccessToken ||
    Date.now() >= settings.fitbitTokenExpiresAt - 30_000;
  const token = hasExpiredToken
    ? await refreshTokens({
        clientId: settings.fitbitClientId,
        clientSecret: settings.fitbitClientSecret,
        refreshToken: settings.fitbitRefreshToken,
      })
    : {
        access_token: settings.fitbitAccessToken,
        refresh_token: settings.fitbitRefreshToken,
        expires_in: Math.floor(
          (settings.fitbitTokenExpiresAt - Date.now()) / 1000,
        ),
        user_id: settings.fitbitUserId,
      };

  const [profile, sleepToday] = await Promise.all([
    fetchFitbitJson(token.access_token, "/1/user/-/profile.json"),
    fetchFitbitJson(token.access_token, "/1.2/user/-/sleep/date/today.json"),
  ]);

  const profileJson = profile as FitbitProfileResponse;
  const memberSince = profileJson.user?.memberSince || toIsoDate(new Date());
  const datesToSync = getFitbitDatesToSync({
    lastDateSynced: settings.fitbitLastDateSynced,
    memberSince,
  });

  const syncedDates: string[] = [];

  for (const date of datesToSync) {
    const intraday = await fetchIntradayForDate({
      accessToken: token.access_token,
      date,
    });

    await writeJson(
      vault,
      `${fitbitDataDirectory}/intraday/${date}.json`,
      intraday,
    );
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
    fitbitAccessToken: token.access_token,
    fitbitRefreshToken: token.refresh_token,
    fitbitTokenExpiresAt: Date.now() + Math.max(token.expires_in, 60) * 1000,
    fitbitUserId: token.user_id,
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
