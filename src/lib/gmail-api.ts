import { z } from "zod";
import { load } from "cheerio";

export class GmailApiError extends Error {
  status: number;
  constructor(status: number) {
    super(
      `Google Gmail: HTTP ${status}. Verifică permisiunile și limitele contului.`,
    );
    this.status = status;
  }
}
export class GmailDeferredError extends Error {}
export class GmailStoppedError extends Error {}

export async function googleToken(
  body: URLSearchParams,
  transport: typeof fetch = fetch,
) {
  const response = await transport("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) throw new GmailApiError(response.status);
  return z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().optional(),
      scope: z.string().optional(),
    })
    .parse(await response.json());
}
export async function gmailApi<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  transport: typeof fetch = fetch,
): Promise<T> {
  // In particular, messages.send is attempted exactly once, including on 429/5xx.
  const response = await transport(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new GmailApiError(response.status);
  return (await response.json()) as T;
}
export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
};
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};
function decodeText(bytes: Uint8Array, charset = "utf-8") {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
// Gmail headers may contain RFC 2047 encoded words and folded lines. Decode
// display headers only; Message-ID and address matching retain their raw value.
export function gmailSubject(mail: GmailMessage) {
  return gmailHeader(mail, "subject")
    .replace(/\r?\n[\t ]+/g, " ")
    .replace(/(\?=)[\t ]+(?==\?)/g, "$1")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (word: string, charset: string, mode: string, encoded: string) => {
        try {
          const bytes =
            mode.toLowerCase() === "b"
              ? Buffer.from(encoded, "base64")
              : Buffer.from(
                  Array.from(
                    encoded
                      .replaceAll("_", " ")
                      .matchAll(/=([a-f0-9]{2})|([^=])/gi),
                    (match) =>
                      match[1]
                        ? parseInt(match[1], 16)
                        : match[2].charCodeAt(0),
                  ),
                );
          return decodeText(bytes, charset);
        } catch {
          return word;
        }
      },
    )
    .replace(/[\r\n\u0000]/g, " ")
    .slice(0, 300);
}
export function gmailHeader(mail: GmailMessage, name: string) {
  return (
    mail.payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}
export function gmailAddress(header: string) {
  const candidate = header.match(/<([^<>]+)>/)?.[1] || header.trim();
  const parsed = z.email().safeParse(candidate.toLowerCase().trim());
  return parsed.success ? parsed.data : null;
}
export function gmailBody(mail: GmailMessage) {
  const plain: string[] = [],
    html: string[] = [];
  function walk(part?: GmailPart) {
    if (!part) return;
    const disposition =
      part.headers?.find(
        (header) => header.name.toLowerCase() === "content-disposition",
      )?.value || "";
    // Attached text/HTML files and forwarded messages are not the reply body.
    if (
      part.filename ||
      /^attachment\b/i.test(disposition) ||
      part.mimeType === "message/rfc822"
    )
      return;
    if (
      part.body?.data &&
      ["text/plain", "text/html"].includes(part.mimeType || "")
    ) {
      const contentType =
        part.headers?.find(
          (header) => header.name.toLowerCase() === "content-type",
        )?.value || "";
      const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
      const text = decodeText(
        Buffer.from(part.body.data, "base64url"),
        charset,
      );
      if (part.mimeType === "text/plain") plain.push(text);
      else if (part.mimeType === "text/html") html.push(text);
    }
    part.parts?.forEach(walk);
  }
  walk(mail.payload);
  let body = plain.join("\n").trim();
  if (!body && html.length) {
    const document = load(html.join("\n"));
    document("script,style,head,iframe,object,template").remove();
    document("br").replaceWith("\n");
    document("p,div,li,tr,h1,h2,h3,h4,blockquote").append("\n");
    body = document("body")
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/\n[\t ]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return (body || "Mesaj fără conținut text. Deschide Gmail pentru atașamente.")
    .replace(/\u0000/g, "")
    .slice(0, 20000);
}
export function gmailAttachments(mail: GmailMessage) {
  const filenames: string[] = [];
  function walk(part?: GmailPart) {
    if (!part) return;
    if (part.filename && filenames.length < 20)
      filenames.push(
        part.filename.replace(/[\u0000-\u001f]/g, "").slice(0, 200),
      );
    part.parts?.forEach(walk);
  }
  walk(mail.payload);
  return filenames;
}
