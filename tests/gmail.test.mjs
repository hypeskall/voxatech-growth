import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGmailState,
  verifyGmailState,
  sealGmailSecret,
  openGmailSecret,
  gmailMime,
  gmailScopes,
} from "../src/lib/gmail-security.ts";
import {
  gmailApi,
  GmailApiError,
  gmailBody,
  gmailAddress,
  gmailSubject,
  gmailAttachments,
} from "../src/lib/gmail-api.ts";

process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
test("OAuth state and encrypted credentials are bound to the user and organization", () => {
  const state = createGmailState("organization-a", "user-a");
  assert.equal(
    verifyGmailState(state.cookie, state.state, "organization-a", "user-a")
      .verifier,
    state.verifier,
  );
  for (const args of [
    [state.cookie, "wrong", "organization-a", "user-a"],
    [state.cookie, state.state, "organization-b", "user-a"],
    [state.cookie, state.state, "organization-a", "user-b"],
  ])
    assert.throws(() => verifyGmailState(...args));
  const encrypted = sealGmailSecret(
    "refresh-secret",
    "organization-a:subject-a",
  );
  assert.ok(!encrypted.includes("refresh-secret"));
  assert.equal(
    openGmailSecret(encrypted, "organization-a:subject-a"),
    "refresh-secret",
  );
  assert.throws(() => openGmailSecret(encrypted, "organization-b:subject-a"));
  const expired = sealGmailSecret(
    JSON.stringify({
      state: "state",
      verifier: "verifier",
      org: "a",
      user: "b",
      expires: 0,
    }),
    "oauth-state",
  );
  assert.throws(() => verifyGmailState(expired, "state", "a", "b"));
  assert.ok(
    gmailScopes.includes("https://www.googleapis.com/auth/gmail.readonly"),
  );
});
test("Incoming encoded subjects preserve folded Romanian and legacy charset text", () => {
  function subject(value) {
    return gmailSubject({
      id: "subject",
      payload: { headers: [{ name: "Subject", value }] },
    });
  }
  const first = Buffer.from("Programări ").toString("base64");
  const second = Buffer.from("în clinică").toString("base64");
  assert.equal(
    subject(`=?UTF-8?B?${first}?=\r\n =?UTF-8?B?${second}?=`),
    "Programări în clinică",
  );
  assert.equal(subject("=?UTF-8?Q?V=C4=83_mul=C8=9Bumim?="), "Vă mulțumim");
  assert.equal(subject("=?ISO-8859-1?Q?Caf=E9?="), "Café");
  assert.equal(subject("Subiect normal"), "Subiect normal");
});
test("Attached text is not mistaken for the reply and HTML entities and blank alternatives are handled", () => {
  const mail = {
    id: "attachments",
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          filename: "contract.txt",
          body: {
            data: Buffer.from("attached contract").toString("base64url"),
          },
        },
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("  ").toString("base64url") },
            },
            {
              mimeType: "text/html",
              body: {
                data: Buffer.from(
                  "<style>bad</style><p>Salut &#537;i mul&#355;umesc!</p><div>Vrem un demo.</div>",
                ).toString("base64url"),
              },
            },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "ofertă.pdf",
          body: { data: Buffer.from("binary").toString("base64url") },
        },
      ],
    },
  };
  assert.equal(gmailBody(mail), "Salut și mulţumesc!\nVrem un demo.");
  assert.deepEqual(gmailAttachments(mail), ["contract.txt", "ofertă.pdf"]);
  assert.equal(
    gmailBody({
      id: "legacy",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Content-Type", value: 'text/plain; charset="iso-8859-1"' },
        ],
        body: {
          data: Buffer.from([0x43, 0x61, 0x66, 0xe9]).toString("base64url"),
        },
      },
    }),
    "Café",
  );
});
test("Gmail MIME preserves Romanian text, replies and unsubscribe, and rejects header injection", () => {
  const input = {
    from: "voxa.sender@gmail.com",
    to: "contact@clinica.ro",
    subject: "Re: Programări în clinică",
    text: "Bună ziua! Vă mulțumim.",
    key: "delivery-1",
    unsubscribe: "https://voxa.ro/unsubscribe/token",
    inReplyTo: "<reply@clinica.ro>",
  };
  const raw = Buffer.from(gmailMime(input), "base64url").toString("utf8");
  assert.doesNotThrow(() =>
    gmailMime({ ...input, subject: `Re: ${"ă".repeat(300)}` }),
  );
  assert.match(raw, /Reply-To: voxa.sender@gmail.com/);
  assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.match(raw, /In-Reply-To: <reply@clinica.ro>/);
  const body = Buffer.from(
    raw.split("\r\n\r\n")[1].replaceAll("\r\n", ""),
    "base64",
  ).toString("utf8");
  assert.ok(body.includes(input.text));
  assert.ok(body.includes(input.unsubscribe));
  assert.throws(() =>
    gmailMime({ ...input, subject: "Subject\r\nBcc: attacker@gmail.com" }),
  );
  assert.throws(() =>
    gmailMime({ ...input, inReplyTo: "<x@a.ro>\r\nBcc: attacker@gmail.com" }),
  );
});
test("Gmail send never retries a provider rejection or ambiguous network failure", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    let calls = 0;
    const transport = async () => {
      calls++;
      return new Response("{}", { status });
    };
    await assert.rejects(
      () =>
        gmailApi(
          "secret",
          "messages/send",
          { method: "POST", body: "{}" },
          transport,
        ),
      GmailApiError,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(() =>
    gmailApi("secret", "messages/send", { method: "POST" }, async () => {
      calls++;
      throw new Error("Timeout");
    }),
  );
  assert.equal(calls, 1);
});
test("Incoming MIME selects plain text, decodes UTF-8 and avoids displaying active HTML", () => {
  const text = "Bună, vrem un demo.";
  const encoded = Buffer.from(text).toString("base64url");
  assert.equal(
    gmailBody({
      id: "1",
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<script>bad()</script><p>HTML</p>").toString(
                "base64url",
              ),
            },
          },
          { mimeType: "text/plain", body: { data: encoded } },
        ],
      },
    }),
    text,
  );
  assert.equal(
    gmailAddress("Dr. Popescu <CONTACT@CLINICA.RO>"),
    "contact@clinica.ro",
  );
  assert.equal(gmailAddress("unknown sender"), null);
  const html = gmailBody({
    id: "2",
    payload: {
      mimeType: "text/html",
      body: {
        data: Buffer.from(
          "<script>bad()</script><p>Salut &amp; mulțumesc</p>",
        ).toString("base64url"),
      },
    },
  });
  assert.equal(html, "Salut & mulțumesc");
});
