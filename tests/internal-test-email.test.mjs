import { test } from "node:test";
import assert from "node:assert/strict";
import {
  internalTestRecipient,
  internalTestRequest,
} from "../src/lib/internal-test-email.ts";

test("internal email tests accept only a message id from the browser", () => {
  const id = "58e6c6ac-2c33-44b0-855f-8472ca6b0ea8";
  assert.equal(internalTestRequest.safeParse({ id }).success, true);
  assert.equal(
    internalTestRequest.safeParse({ id, recipient: "prospect@clinica.ro" })
      .success,
    false,
  );
  assert.equal(
    internalTestRequest.safeParse({ id, to: "prospect@clinica.ro" }).success,
    false,
  );
});

test("internal email recipient comes only from valid server configuration", () => {
  assert.equal(
    internalTestRecipient(" Internal@Test.Example "),
    "internal@test.example",
  );
  assert.throws(() => internalTestRecipient(undefined));
  assert.throws(() => internalTestRecipient("not-an-email"));
});
