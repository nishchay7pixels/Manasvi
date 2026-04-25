import assert from "node:assert/strict";
import test from "node:test";

import { parseSecretErrorCode, sanitizeIncomingSecretValues } from "./secrets.js";

test("sanitizeIncomingSecretValues allows only declared references", () => {
  const sanitized = sanitizeIncomingSecretValues(
    {
      "secret://tenant/local/api/token": "value-1"
    },
    ["secret://tenant/local/api/token"]
  );
  assert.equal(sanitized["secret://tenant/local/api/token"], "value-1");
});

test("sanitizeIncomingSecretValues rejects undeclared reference", () => {
  assert.throws(
    () =>
      sanitizeIncomingSecretValues(
        {
          "secret://tenant/local/api/token": "value-1"
        },
        []
      ),
    /SECRET_REFERENCE_NOT_ALLOWED/
  );
});

test("parseSecretErrorCode extracts code prefix", () => {
  assert.equal(parseSecretErrorCode(new Error("SECRET_ACCESS_DENIED:secret://tenant/demo/key")), "SECRET_ACCESS_DENIED");
  assert.equal(parseSecretErrorCode(new Error("plain error")), "plain error");
});
