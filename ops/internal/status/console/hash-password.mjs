#!/usr/bin/env node
/**
 * Turns a password into the value for CONSOLE_PASSWORD_HASH.
 *
 * Reads from stdin rather than argv so the password does not land in shell
 * history or in the process list on a shared box.
 *
 *   printf '%s' 'the-password' | node hash-password.mjs
 */

import { randomBytes, scryptSync } from "node:crypto";

let password = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (password += c));
process.stdin.on("end", () => {
  password = password.replace(/\n$/, "");

  if (password.length < 16) {
    console.error(
      `Refusing: ${password.length} characters. This is the only thing between\n` +
        "the internet and Gryt's status page. Use a generated one from Bitwarden.",
    );
    process.exit(1);
  }

  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);

  console.log(`scrypt$${salt.toString("base64")}$${hash.toString("base64")}`);
});
