import type { RequestListener } from "node:http";

import { GoogleHealthError, googleHealthScopes } from "./google-health";

const loopbackHost = "127.0.0.1";
const authorizationTimeoutMillis = 5 * 60 * 1000;

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function newOAuthNonce() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function openSystemBrowser(url: string): Promise<void> {
  // Load desktop APIs only when linking from Obsidian desktop.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shell } = require("electron") as {
    shell: { openExternal(url: string): Promise<void> };
  };
  return shell.openExternal(url);
}

function createDesktopServer(listener: RequestListener) {
  // Keep Node's HTTP module out of the mobile plugin startup path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createServer } = require("http") as typeof import("node:http");
  return createServer(listener);
}

export async function getGoogleAuthorizationCode(
  clientId: string,
  signal: AbortSignal,
  openBrowser = openSystemBrowser,
  createLoopbackServer = createDesktopServer,
) {
  signal.throwIfAborted();
  const state = newOAuthNonce();
  const codeVerifier = newOAuthNonce();
  const challenge = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  signal.throwIfAborted();

  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: googleHealthScopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    code_challenge: base64Url(new Uint8Array(challenge)),
    code_challenge_method: "S256",
    state,
  }).toString();

  let redirectUri: string;
  let acceptCode!: (code: string) => void;
  let fail!: (error: unknown) => void;
  const result = new Promise<string>((resolve, reject) => {
    acceptCode = resolve;
    fail = reject;
  });
  const server = createLoopbackServer((request, response) => {
    const [path, query] = (request.url ?? "").split("?", 2);
    const params = new URLSearchParams(query);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Connection", "close");

    if (
      request.method !== "GET" ||
      path !== "/" ||
      params.get("state") !== state
    ) {
      response.writeHead(400).end("Invalid Google Health sign-in callback.");
      return;
    }
    const code = params.get("code");
    if (params.has("error") || !code) {
      response
        .writeHead(400)
        .end("Google Health sign-in was canceled. Return to Obsidian.");
      fail(new GoogleHealthError("Google Health sign-in was canceled."));
      return;
    }
    response.end(
      "Sign-in response received. Return to Obsidian to check the connection.",
    );
    acceptCode(code);
  });

  const cancel = () =>
    fail(new GoogleHealthError("Google Health sign-in was canceled."));
  const timeout = setTimeout(
    () =>
      fail(
        new GoogleHealthError(
          "Google Health sign-in timed out. Try connecting again.",
        ),
      ),
    authorizationTimeoutMillis,
  );
  signal.addEventListener("abort", cancel, { once: true });
  server.on("error", fail);
  server.setTimeout(10_000);
  server.listen(0, loopbackHost, () => {
    if (signal.aborted) return;
    const address = server.address();
    if (!address || typeof address === "string") {
      fail(
        new GoogleHealthError(
          "Could not open the Google Health sign-in callback.",
        ),
      );
      return;
    }
    redirectUri = `http://${loopbackHost}:${address.port}`;
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    void Promise.resolve()
      .then(() => openBrowser(authorizationUrl.toString()))
      .catch(fail);
  });

  try {
    const code = await result;
    return { code, codeVerifier, redirectUri: redirectUri! };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
    server.close();
  }
}
