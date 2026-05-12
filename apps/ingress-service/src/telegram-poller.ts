/**
 * TelegramPoller — long-polling adapter for Telegram Bot API.
 *
 * In local/dev mode, Manasvi polls Telegram for updates instead of requiring
 * a public webhook URL. This is the default Telegram experience for new users.
 *
 * Design:
 * - Calls getUpdates with a long-poll timeout (25s by default)
 * - Tracks the offset to avoid reprocessing updates
 * - Automatically retries with exponential backoff on failure
 * - Reports live status so health checks and CLI diagnostics can query it
 * - Normalizes each update through the same path as webhook mode
 *
 * Trust model:
 * - In polling mode, Manasvi is the initiating party: we authenticate TO Telegram
 *   using our bot token. There is no spoofing vector for delivered updates.
 * - Source authenticity is marked "strong" (token-authenticated, bot-initiated request).
 * - The normalized message still carries EXTERNAL_UNTRUSTED payload trust — the message
 *   content from the user remains untrusted regardless of transport.
 */

import { randomUUID } from "node:crypto";

export interface TelegramPollerConfig {
  botToken: string;
  apiBaseUrl: string;
  /** Long-poll timeout in seconds. Telegram supports 0–50s. Default: 25. */
  longPollTimeoutSeconds: number;
  tenantId: string;
  workspaceId: string;
}

export interface TelegramPollerStatus {
  running: boolean;
  offset: number;
  updatesReceived: number;
  /** ISO timestamp of last getUpdates call (success or empty). */
  lastPollAt: string | null;
  /** ISO timestamp of last batch that contained updates. */
  lastUpdateAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  mode: "polling";
}

export interface TelegramPollingTrace {
  traceId: string;
  correlationId: string;
}

export type TelegramPollingUpdateHandler = (
  update: unknown,
  trace: TelegramPollingTrace
) => Promise<void>;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("AbortError"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function backoffMs(consecutiveErrors: number): number {
  // 3s, 6s, 12s, 24s, 60s cap
  return Math.min(3000 * Math.pow(2, Math.max(0, consecutiveErrors - 1)), 60000);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class TelegramPoller {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private sleepAbortController: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  private _status: TelegramPollerStatus = {
    running: false,
    offset: 0,
    updatesReceived: 0,
    lastPollAt: null,
    lastUpdateAt: null,
    lastError: null,
    consecutiveErrors: 0,
    mode: "polling"
  };

  constructor(private readonly config: TelegramPollerConfig) {}

  /**
   * Start the polling loop. Non-blocking — the loop runs in the background.
   * Calling start() more than once is a no-op if already running.
   */
  start(handler: TelegramPollingUpdateHandler): void {
    if (this.running) return;
    this.running = true;
    this._status.running = true;
    this.loopPromise = this.loop(handler).finally(() => {
      this.loopPromise = null;
    });
  }

  /**
   * Stop the polling loop gracefully.
   * Any in-flight long-poll request will be aborted.
   */
  async stop(): Promise<void> {
    this.running = false;
    this._status.running = false;
    this.abortController?.abort();
    this.sleepAbortController?.abort();
    await this.loopPromise;
  }

  getStatus(): Readonly<TelegramPollerStatus> {
    return { ...this._status };
  }

  private async loop(handler: TelegramPollingUpdateHandler): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.fetchUpdates();
        this._status.lastPollAt = new Date().toISOString();

        if (updates.length > 0) {
          for (const update of updates) {
            const trace: TelegramPollingTrace = {
              traceId: randomUUID(),
              correlationId: randomUUID()
            };
            try {
              await handler(update, trace);
            } catch (handlerErr) {
              // Do not crash the poller, but surface handler failure for diagnostics.
              const msg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
              this._status.lastError = `handler_error:${msg}`;
              this._status.lastPollAt = new Date().toISOString();
              // Still advance offset so we don't replay a failing update forever.
            }
            const uid = (update as { update_id?: number }).update_id;
            if (typeof uid === "number") {
              this.offset = uid + 1;
              this._status.offset = this.offset;
            }
          }
          this._status.lastUpdateAt = new Date().toISOString();
          this._status.updatesReceived += updates.length;
        }

        this._status.consecutiveErrors = 0;
        this._status.lastError = null;
      } catch (err) {
        if (!this.running) break; // aborted intentionally

        const msg = err instanceof Error ? err.message : String(err);
        // Suppress AbortError noise from intentional stop()
        if (msg.includes("aborted") || msg.includes("AbortError")) break;

        this._status.lastError = msg;
        this._status.consecutiveErrors++;
        this._status.lastPollAt = new Date().toISOString();

        const delay = backoffMs(this._status.consecutiveErrors);
        this.sleepAbortController = new AbortController();
        try {
          await sleep(delay, this.sleepAbortController.signal);
        } catch {
          if (!this.running) break;
        } finally {
          this.sleepAbortController = null;
        }
      }

      // Prevent starvation when fetch resolves immediately (e.g., tests with mocked fetch).
      await yieldToEventLoop();
    }
    this._status.running = false;
  }

  private async fetchUpdates(): Promise<unknown[]> {
    const params = new URLSearchParams({
      offset: String(this.offset),
      timeout: String(this.config.longPollTimeoutSeconds),
      allowed_updates: JSON.stringify(["message", "callback_query"])
    });

    const url = `${this.config.apiBaseUrl.replace(/\/$/, "")}/bot${this.config.botToken}/getUpdates?${params.toString()}`;

    // AbortController with timeout slightly longer than the long-poll to catch hangs
    this.abortController = new AbortController();
    const timeoutId = setTimeout(
      () => this.abortController?.abort(),
      (this.config.longPollTimeoutSeconds + 10) * 1000
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "(unreadable)");
        throw new Error(`Telegram API returned ${response.status}: ${body}`);
      }

      const data = (await response.json()) as { ok: boolean; result?: unknown[]; description?: string };
      if (!data.ok) {
        throw new Error(`Telegram getUpdates error: ${data.description ?? "unknown"}`);
      }

      return data.result ?? [];
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
