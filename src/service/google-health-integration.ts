import type { Vault } from "obsidian";

import {
  GoogleHealthError,
  googleHealthConnectionSchema,
  linkGoogleHealth,
  revokeGoogleHealth,
  shouldSyncGoogleHealth,
  syncGoogleHealthData,
  type GoogleHealthConnection,
  type GoogleHealthCredentials,
} from "./google-health";
import { getGoogleAuthorizationCode } from "./google-health-oauth";

// Obsidian's current Secret Storage API is newer than the plugin's minimum API typings.
export interface GoogleHealthSecretStorage {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

export class GoogleHealthIntegration {
  private connection?: GoogleHealthConnection;
  private authorization?: AbortController;
  private revokingAccess = false;
  private syncRequest?: {
    controller: AbortController;
    result: Promise<boolean>;
  };

  constructor(
    private readonly vault: Vault,
    private readonly secretStorage: GoogleHealthSecretStorage,
    private readonly storageKey: string,
  ) {
    try {
      const stored = secretStorage.getSecret(storageKey);
      if (!stored) return;
      this.connection = googleHealthConnectionSchema.safeParse(
        JSON.parse(stored),
      ).data;
    } catch {
      // A damaged local record should not prevent the planner from loading.
    }
  }

  get connected() {
    return Boolean(this.connection);
  }

  async connect(client: GoogleHealthCredentials) {
    if (!client.clientId || !client.clientSecret) {
      throw new GoogleHealthError(
        "Enter the Google OAuth Desktop app client ID and secret.",
      );
    }
    if (this.revokingAccess) {
      throw new GoogleHealthError(
        "Wait for Google Health to finish disconnecting.",
      );
    }
    if (this.authorization) {
      throw new GoogleHealthError(
        "Google Health sign-in is already open in your browser.",
      );
    }

    const controller = new AbortController();
    this.authorization = controller;
    try {
      const authorization = await getGoogleAuthorizationCode(
        client.clientId,
        controller.signal,
      );
      const connection = await linkGoogleHealth(client, authorization);
      controller.signal.throwIfAborted();

      if (this.connection?.userId === connection.userId) {
        connection.lastCompletedDate = this.connection.lastCompletedDate;
      }
      this.saveConnection(connection);
      this.syncRequest?.controller.abort();
    } finally {
      this.authorization = undefined;
    }
  }

  async disconnect() {
    const connection = this.connection;
    this.abort();
    this.secretStorage.setSecret(this.storageKey, "");
    this.connection = undefined;
    if (!connection) return;

    this.revokingAccess = true;
    try {
      await revokeGoogleHealth(connection.refreshToken);
    } finally {
      this.revokingAccess = false;
    }
  }

  abort() {
    this.authorization?.abort();
    this.syncRequest?.controller.abort();
  }

  async sync(force: boolean): Promise<boolean> {
    const connection = this.connection;
    if (!connection) return false;
    if (this.authorization) {
      if (force)
        throw new GoogleHealthError(
          "Finish Google Health sign-in before syncing.",
        );
      return false;
    }

    if (this.syncRequest) {
      if (!this.syncRequest.controller.signal.aborted)
        return this.syncRequest.result;
      await this.syncRequest.result.catch(() => {});
      return this.sync(force);
    }
    if (!force && !shouldSyncGoogleHealth(connection)) return false;

    const controller = new AbortController();
    const result = syncGoogleHealthData({
      vault: this.vault,
      connection,
      signal: controller.signal,
      onProgress: (updated) => this.saveConnection(updated),
    })
      .then(() => true)
      .finally(() => {
        this.syncRequest = undefined;
      });
    this.syncRequest = { controller, result };
    return result;
  }

  private saveConnection(connection: GoogleHealthConnection) {
    this.secretStorage.setSecret(this.storageKey, JSON.stringify(connection));
    this.connection = connection;
  }
}
