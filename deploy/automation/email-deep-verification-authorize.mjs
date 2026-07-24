#!/usr/bin/env node

import {readFile, writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

import {
  createEmailDeepVerificationAuthorization,
} from "./email-deep-verification.mjs";

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !new Set(["--config", "--recipient", "--output"]).has(name) ||
      !value ||
      value.startsWith("--") ||
      options[name]
    ) {
      throw new TypeError(
        "usage: email-deep-verification-authorize --config <path> --recipient <email> --output <path>",
      );
    }
    options[name] = value;
  }
  if (!options["--config"] || !options["--recipient"] || !options["--output"]) {
    throw new TypeError(
      "usage: email-deep-verification-authorize --config <path> --recipient <email> --output <path>",
    );
  }
  return options;
}

export async function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_);
  const config = JSON.parse(await readFile(options["--config"], "utf8"));
  const authorization = await createEmailDeepVerificationAuthorization({
    config,
    recipient: options["--recipient"],
  });
  await writeFile(
    options["--output"],
    `${JSON.stringify(authorization, null, 2)}\n`,
    {flag: "wx", mode: 0o600},
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? "email_deep_verification_authorization_failed"}\n`);
    process.exitCode = 2;
  });
}

