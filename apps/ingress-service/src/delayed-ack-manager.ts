/**
 * Delayed acknowledgement manager.
 *
 * Behavior contract:
 *  - Fast responses (< ackDelayMs): no ack emitted, only final answer
 *  - Slow responses (>= ackDelayMs): one ack emitted, then final answer
 *  - At most one ack per request, never after final answer
 *  - Ack timer is cancelled if final response arrives in time
 *  - Channel-aware: sendFn is caller-supplied and channel-specific
 *
 * Designed to coexist with future streaming / typing-indicator systems:
 * callers can skip startRequest or call cancelRequest to suppress ack.
 */

export type WorkflowType =
  | "fast_direct_response"
  | "tool_use"
  | "web_search"
  | "gmail_read"
  | "gmail_write"
  | "calendar_read"
  | "drive_read"
  | "file_read"
  | "approval_wait"
  | "remote_execution"
  | "long_summary"
  | "generic";

export type ChannelType = "telegram" | "slack" | "webui" | "generic";

export interface AckLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface DelayedAckConfig {
  /** Master switch — set false to disable all acks globally. */
  enabled: boolean;
  /** Milliseconds after request start before ack is sent. Default: 2000. */
  ackDelayMs: number;
  /** If true, use workflow-contextual ack messages when workflow type is known. */
  contextualAckEnabled: boolean;
}

interface RequestState {
  readonly requestId: string;
  readonly sessionId: string;
  readonly channelType: ChannelType;
  readonly workflowType: WorkflowType;
  readonly ackMessage: string;
  readonly startTime: number;
  readonly sendFn: (text: string) => Promise<void>;
  ackSent: boolean;
  finalSent: boolean;
  timerHandle: ReturnType<typeof setTimeout> | null;
}

const GENERIC_ACK_MESSAGES: readonly string[] = [
  "Got it — looking into that.",
  "Checking now.",
  "Working on it.",
  "Looking into your request.",
  "I'm pulling that together."
];

const CONTEXTUAL_ACK_MESSAGES: Partial<Record<WorkflowType, string>> = {
  gmail_read: "Looking through your email now.",
  gmail_write: "Working on your email now.",
  calendar_read: "Got it — checking your calendar.",
  drive_read: "Looking through your Drive now.",
  file_read: "Reading that file now.",
  web_search: "Searching for that now.",
  approval_wait: "Working on it — this may need a moment.",
  remote_execution: "Running that now.",
  long_summary: "Working on it.",
  tool_use: "Checking that now."
};

export class DelayedAckManager {
  private readonly requests = new Map<string, RequestState>();
  private readonly config: DelayedAckConfig;
  private readonly logger: AckLogger;
  private genericAckIndex = 0;

  // Timer functions are injectable for testing; default to global setTimeout/clearTimeout.
  private readonly timerSet: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly timerClear: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(
    config: DelayedAckConfig,
    logger: AckLogger,
    timerOverrides?: {
      set?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clear?: (handle: ReturnType<typeof setTimeout>) => void;
    }
  ) {
    this.config = config;
    this.logger = logger;
    this.timerSet = timerOverrides?.set ?? ((fn, ms) => setTimeout(fn, ms));
    this.timerClear = timerOverrides?.clear ?? ((h) => clearTimeout(h));
  }

  /**
   * Register a new in-flight request and start the ack timer.
   * Call this immediately after publishing the inbound event to the orchestrator.
   *
   * If acks are disabled, this is a no-op.
   * workflowType is optional; omit for generic fallback.
   */
  startRequest(input: {
    requestId: string;
    sessionId: string;
    channelType: ChannelType;
    workflowType?: WorkflowType;
    sendFn: (text: string) => Promise<void>;
  }): void {
    if (!this.config.enabled) return;

    const workflowType = input.workflowType ?? "generic";
    const ackMessage = this.selectAckMessage(workflowType);

    const state: RequestState = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      channelType: input.channelType,
      workflowType,
      ackMessage,
      startTime: Date.now(),
      ackSent: false,
      finalSent: false,
      timerHandle: null,
      sendFn: input.sendFn
    };

    state.timerHandle = this.timerSet(() => {
      void this.handleTimerFired(input.requestId);
    }, this.config.ackDelayMs);

    this.requests.set(input.requestId, state);
    this.logger.debug("delayed-ack: timer started", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      channelType: input.channelType,
      workflowType,
      ackDelayMs: this.config.ackDelayMs
    });
  }

  /**
   * Mark a request as complete (final response is ready/sent).
   * Cancels the pending ack timer if it has not yet fired.
   * Call this just before or just after sending the final channel response.
   */
  finalizeRequest(requestId: string): void {
    const state = this.requests.get(requestId);
    if (!state) return;

    state.finalSent = true;

    if (state.timerHandle !== null) {
      this.timerClear(state.timerHandle);
      state.timerHandle = null;
      this.logger.debug("delayed-ack: ack suppressed — final response was fast", {
        requestId,
        sessionId: state.sessionId,
        channelType: state.channelType,
        workflowType: state.workflowType,
        elapsedMs: Date.now() - state.startTime
      });
    } else if (state.ackSent) {
      this.logger.debug("delayed-ack: final response delivered after ack", {
        requestId,
        sessionId: state.sessionId,
        channelType: state.channelType,
        workflowType: state.workflowType,
        elapsedMs: Date.now() - state.startTime
      });
    }

    this.requests.delete(requestId);
  }

  /**
   * Cancel a request entirely (e.g., on processing error or request abandonment).
   * Prevents ack from firing; does not attempt to send any message.
   */
  cancelRequest(requestId: string, reason: string): void {
    const state = this.requests.get(requestId);
    if (!state) return;

    if (state.timerHandle !== null) {
      this.timerClear(state.timerHandle);
      state.timerHandle = null;
    }

    this.logger.debug("delayed-ack: request cancelled", {
      requestId,
      sessionId: state.sessionId,
      channelType: state.channelType,
      workflowType: state.workflowType,
      reason
    });

    this.requests.delete(requestId);
  }

  /** Number of currently tracked in-flight requests. Useful for health/test checks. */
  get activeRequestCount(): number {
    return this.requests.size;
  }

  private async handleTimerFired(requestId: string): Promise<void> {
    const state = this.requests.get(requestId);
    if (!state) return;

    // Guard: final response arrived just before or concurrently with timer fire.
    if (state.finalSent) return;

    // Guard: prevent duplicate ack (should not happen with correct usage, but defensive).
    if (state.ackSent) return;

    state.ackSent = true;
    state.timerHandle = null;

    try {
      await state.sendFn(state.ackMessage);
      this.logger.info("delayed-ack: ack sent", {
        requestId,
        sessionId: state.sessionId,
        channelType: state.channelType,
        workflowType: state.workflowType,
        ackMessage: state.ackMessage,
        elapsedMs: Date.now() - state.startTime
      });
    } catch (error) {
      this.logger.error("delayed-ack: ack send failed", {
        requestId,
        sessionId: state.sessionId,
        channelType: state.channelType,
        workflowType: state.workflowType,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private selectAckMessage(workflowType: WorkflowType): string {
    if (this.config.contextualAckEnabled) {
      const contextual = CONTEXTUAL_ACK_MESSAGES[workflowType];
      if (contextual) return contextual;
    }
    // Rotate through generic messages instead of random-picking to keep tests deterministic
    // and avoid repeating the same message in quick succession.
    const msg = GENERIC_ACK_MESSAGES[this.genericAckIndex % GENERIC_ACK_MESSAGES.length] ?? "Working on it.";
    this.genericAckIndex++;
    return msg;
  }
}

/**
 * Estimates the likely workflow type from the user's message text.
 * Returns "generic" when no strong signal is found.
 * Used as a lightweight heuristic — callers may always override with an explicit hint.
 */
export function detectWorkflowType(messageText: string): WorkflowType {
  const lower = messageText.toLowerCase();

  const isEmailWord = /\b(email|gmail|inbox|unread|message|messages)\b/.test(lower);
  const isWriteAction = /\b(send|compose|write|reply|forward|draft)\b/.test(lower);

  // Explicit email context + write action → gmail_write
  if (isEmailWord && isWriteAction) return "gmail_write";
  if (isEmailWord) return "gmail_read";
  // Composition verb without explicit "email" word — treat as gmail_write
  if (isWriteAction && /\b(compose|draft)\b/.test(lower)) return "gmail_write";

  // Use `meetings?` to match both "meeting" and "meetings"
  if (/\b(calendar|schedule|appointment|meetings?|event|availability)\b/.test(lower)) {
    return "calendar_read";
  }
  if (/\b(drive|google drive|spreadsheet|sheet)\b/.test(lower)) {
    return "drive_read";
  }
  // Check long_summary before file_read — "document" can appear in both contexts
  if (/\b(summarize|summarise|summary|overview|brief)\b/.test(lower)) {
    return "long_summary";
  }
  if (/\b(file|read file|open file|document)\b/.test(lower)) {
    return "file_read";
  }
  if (/\b(search|look up|find online|google|web)\b/.test(lower)) {
    return "web_search";
  }
  if (/\b(run|execute|command|script|shell)\b/.test(lower)) {
    return "remote_execution";
  }

  return "generic";
}

/**
 * Creates a structured JSON console logger compatible with AckLogger.
 * Matches the inline console.log pattern already used in the ingress-service.
 */
export function createConsoleAckLogger(serviceName: string): AckLogger {
  function log(level: string, message: string, fields?: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: serviceName,
      message,
      ...fields
    };
    if (level === "error") {
      console.error(JSON.stringify(entry));
    } else if (level === "warn") {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields)
  };
}
