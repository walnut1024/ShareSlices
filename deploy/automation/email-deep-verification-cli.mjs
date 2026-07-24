#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

import {
  readEmailDeepVerificationInput,
  runEmailDeepVerification,
} from "./email-deep-verification.mjs";

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !new Set(["--config", "--authorization", "--receipt"]).has(name) ||
      !value ||
      value.startsWith("--") ||
      options[name]
    ) {
      throw new TypeError(
        "usage: email-deep-verification-cli --config <path> --authorization <path> --receipt <path>",
      );
    }
    options[name] = value;
  }
  if (!options["--config"] || !options["--authorization"] || !options["--receipt"]) {
    throw new TypeError(
      "usage: email-deep-verification-cli --config <path> --authorization <path> --receipt <path>",
    );
  }
  return options;
}

export function executorEnvironment({config, execution, secret, inherited = process.env}) {
  const environment = {
    PATH: inherited.PATH ?? "",
    NODE_ENV: "production",
    SHARESLICES_EMAIL_DEEP_ADAPTER: execution.adapter,
    SHARESLICES_EMAIL_DEEP_RECIPIENT: execution.recipient,
    SHARESLICES_EMAIL_DEEP_NONCE: execution.nonce,
    SHARESLICES_EMAIL_DEEP_PROVIDER_NAMESPACE: execution.providerNamespace,
    SHARESLICES_EMAIL_DEEP_SENDER: execution.senderIdentity,
    SHARESLICES_EMAIL_DEEP_TRANSPORT_REVISION: execution.transportRevision,
    SHARESLICES_EMAIL_DEEP_SECRET: secret,
  };
  if (execution.adapter === "smtp") {
    environment.SHARESLICES_EMAIL_DEEP_SMTP_ENDPOINT =
      config.kubernetes.email.endpointIdentity;
    environment.SHARESLICES_EMAIL_DEEP_SMTP_TLS_POLICY =
      config.kubernetes.email.tlsPolicy;
  }
  return environment;
}

export function executeEmailProbe(input, spawn = spawnSync) {
  const secret = process.env.SHARESLICES_EMAIL_DEEP_SECRET;
  if (!secret) throw new Error("email_deep_verification_secret_missing");
  const result = spawn(
    "node",
    [
      "api/node_modules/tsx/dist/cli.mjs",
      "api/src/email/deep-verification-executor.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: executorEnvironment({...input, secret}),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  let output;
  try {
    output = JSON.parse(result.stdout?.trim() ?? "");
  } catch {
    throw new Error("email_deep_verification_executor_invalid");
  }
  if (
    result.status !== 0 ||
    !new Set(["provider_accepted", "indeterminate"]).has(output.outcome)
  ) {
    throw new Error("email_deep_verification_executor_failed");
  }
  return output;
}

export async function main(arguments_ = process.argv.slice(2), output = process.stdout) {
  const options = parseArguments(arguments_);
  if (!process.env.SHARESLICES_EMAIL_DEEP_SECRET) {
    throw new Error("email_deep_verification_secret_missing");
  }
  const input = await readEmailDeepVerificationInput(
    options["--config"],
    options["--authorization"],
  );
  const receipt = await runEmailDeepVerification({
    ...input,
    receiptPath: options["--receipt"],
    send: (execution) => executeEmailProbe({config: input.config, execution}),
  });
  output.write(`${JSON.stringify(receipt)}\n`);
  return receipt.state === "provider_accepted" ? 0 : 6;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${error.code ?? "email_deep_verification_failed"}\n`);
      process.exitCode = 4;
    },
  );
}
