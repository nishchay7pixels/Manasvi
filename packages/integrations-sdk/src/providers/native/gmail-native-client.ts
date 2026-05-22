import {
  validateGoogleNativeCapabilityInput,
  type GmailDraftInput,
  type GmailReadInput,
  type GmailSearchInput,
  type GmailSendInput
} from "../../google-capability-inputs.js";
import type { NativeGoogleApiClient } from "./google-api-client-factory.js";
import {
  normalizeNativeGmailMessage,
  normalizeNativeGmailSearch,
  type NativeGmailMessageRaw
} from "./native-output-normalizers.js";

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mimeMessage(input: GmailDraftInput | GmailSendInput): string {
  const lines = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${input.subject.replace(/\r?\n/g, " ")}`,
    `Content-Type: ${input.bodyHtml ? "text/html" : "text/plain"}; charset=utf-8`,
    "MIME-Version: 1.0",
    "",
    input.bodyHtml ?? input.bodyText ?? ""
  ];
  return lines.join("\r\n");
}

export class GmailNativeClient {
  constructor(
    private readonly apiClient: NativeGoogleApiClient,
    private readonly baseUrl = "https://gmail.googleapis.com/gmail/v1/users/me"
  ) {}

  async search(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.gmail.search", input) as GmailSearchInput;
    const listParams = new URLSearchParams({
      q: validated.query,
      maxResults: String(validated.limit ?? 10)
    });
    const listed = await this.apiClient.get<{ messages?: Array<{ id: string; threadId?: string }> }>(
      `${this.baseUrl}/messages?${listParams.toString()}`,
      accessToken
    );
    const messages: NativeGmailMessageRaw[] = [];
    for (const item of listed.messages ?? []) {
      messages.push(await this.apiClient.get<NativeGmailMessageRaw>(
        `${this.baseUrl}/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        accessToken
      ));
    }
    return normalizeNativeGmailSearch(messages);
  }

  async read(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.gmail.read", input) as GmailReadInput;
    if (validated.messageId) {
      const message = await this.apiClient.get<NativeGmailMessageRaw>(
        `${this.baseUrl}/messages/${encodeURIComponent(validated.messageId)}?format=full`,
        accessToken
      );
      return normalizeNativeGmailMessage(message);
    }
    const thread = await this.apiClient.get<{ messages?: NativeGmailMessageRaw[] }>(
      `${this.baseUrl}/threads/${encodeURIComponent(validated.threadId!)}?format=full`,
      accessToken
    );
    const latest = thread.messages?.[0];
    if (!latest) throw new Error("Gmail thread did not contain any messages.");
    return normalizeNativeGmailMessage(latest);
  }

  async draft(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.gmail.draft", input) as GmailDraftInput;
    const result = await this.apiClient.post<{ id: string; message?: { id?: string; threadId?: string } }>(
      `${this.baseUrl}/drafts`,
      { message: { raw: base64Url(mimeMessage(validated)) } },
      accessToken
    );
    return {
      draftId: result.id,
      messageId: result.message?.id,
      threadId: result.message?.threadId,
      createdAt: new Date().toISOString()
    };
  }

  async send(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.gmail.send", input) as GmailSendInput;
    const result = await this.apiClient.post<{ id: string; threadId?: string; labelIds?: string[] }>(
      `${this.baseUrl}/messages/send`,
      {
        raw: base64Url(mimeMessage(validated)),
        ...(validated.replyToMessageId ? { threadId: validated.replyToMessageId } : {})
      },
      accessToken
    );
    return {
      messageId: result.id,
      threadId: result.threadId,
      labelIds: result.labelIds ?? [],
      sentAt: new Date().toISOString()
    };
  }
}
