import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

export const gmailScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
export const gmailStateCookie = "voxa_gmail_oauth";

function key() {
  const configured = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(configured))
    throw new Error(
      "Configurarea Gmail necesită o cheie de criptare de 32 de octeți.",
    );
  return Buffer.from(configured, "hex");
}
export function sealGmailSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function openGmailSecret(value: string, context: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Conexiune Gmail invalidă.");
  const [iv, tag, ciphertext] = parts.map((part) =>
    Buffer.from(part, "base64url"),
  );
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
export function gmailConfigurationReady() {
  return (
    !!process.env.GOOGLE_GMAIL_CLIENT_ID &&
    !!process.env.GOOGLE_GMAIL_CLIENT_SECRET &&
    /^[a-f0-9]{64}$/i.test(process.env.GMAIL_TOKEN_ENCRYPTION_KEY || "") &&
    !!process.env.INTERNAL_TEST_EMAIL
  );
}
export function createGmailState(org: string, user: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const cookie = sealGmailSecret(
    JSON.stringify({
      state,
      verifier,
      org,
      user,
      expires: Date.now() + 600000,
    }),
    "oauth-state",
  );
  return {
    state,
    verifier,
    cookie,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
export function verifyGmailState(
  cookie: string,
  state: string,
  org: string,
  user: string,
) {
  const value = z
    .object({
      state: z.string(),
      verifier: z.string(),
      org: z.string(),
      user: z.string(),
      expires: z.number(),
    })
    .parse(JSON.parse(openGmailSecret(cookie, "oauth-state")));
  const left = Buffer.from(value.state),
    right = Buffer.from(state);
  if (
    left.length !== right.length ||
    !timingSafeEqual(left, right) ||
    value.org !== org ||
    value.user !== user ||
    value.expires <= Date.now()
  )
    throw new Error("Conectarea Gmail a expirat. Încearcă din nou.");
  return value;
}

export function gmailMime(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  key: string;
  unsubscribe?: string;
  inReplyTo?: string;
}) {
  const from = z.email().parse(input.from),
    to = z.email().parse(input.to);
  if (
    /[\r\n]/u.test(input.subject) ||
    /[\r\n]/u.test(from + to) ||
    // Stored subjects allow 300 characters; a reply may add "Re: ".
    input.subject.length > 304
  )
    throw new Error("Antet email invalid.");
  const messageId = createHash("sha256")
    .update(`${from}:${input.key}`)
    .digest("hex");
  const headers = [
    `From: Voxa <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    // Fold encoded words within RFC 2047's 75 character maximum.
    "Subject: " +
      (input.subject.match(/.{1,10}/gu) || [""])
        .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`)
        .join("\r\n "),
    `Message-ID: <${messageId}@${from.split("@")[1]}>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (input.inReplyTo) {
    if (!/^<[^<>\s]+@[^<>\s]+>$/.test(input.inReplyTo))
      throw new Error("Referință email invalidă.");
    headers.push(
      `In-Reply-To: ${input.inReplyTo}`,
      `References: ${input.inReplyTo}`,
    );
  }
  if (input.unsubscribe) {
    const url = new URL(input.unsubscribe);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      /[\r\n<>]/u.test(input.unsubscribe)
    )
      throw new Error("Adresă de dezabonare invalidă.");
    headers.push(
      `List-Unsubscribe: <${url.href}>`,
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    );
  }
  const body =
    Buffer.from(
      input.text +
        (input.unsubscribe ? `\n\nDezabonare: ${input.unsubscribe}` : ""),
    )
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || "";
  return Buffer.from(headers.join("\r\n") + "\r\n\r\n" + body).toString(
    "base64url",
  );
}
