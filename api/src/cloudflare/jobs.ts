import {
  dispatchOneAuthenticationEmail,
  type AuthenticationEmailDispatchInput,
} from "../application/accounts/authentication-email-dispatcher.js";
import {
  parseCloudflareJobWake,
  type CloudflareJobWake,
  type CloudflareJobWakeLane,
} from "./job-wake.js";
import type {
  CloudflareExecutionContext,
  CloudflareJobsDrains,
  CloudflareScheduledController,
} from "./runtime.js";

export type CloudflareJobHandler<Bindings> = (
  wake: CloudflareJobWake,
  bindings: Bindings,
  context: CloudflareExecutionContext,
) => Promise<void>;

export type CloudflareScheduledDrain<Bindings> = (
  controller: CloudflareScheduledController,
  bindings: Bindings,
  context: CloudflareExecutionContext,
) => Promise<void>;

export function createCloudflareAuthenticationEmailHandler<Bindings>(input: Readonly<{
  compose(bindings: Bindings, wake: CloudflareJobWake): AuthenticationEmailDispatchInput;
  dispatch?: typeof dispatchOneAuthenticationEmail;
}>): CloudflareJobHandler<Bindings> {
  const dispatch = input.dispatch ?? dispatchOneAuthenticationEmail;
  return async (wake, bindings) => {
    if (wake.lane !== "authentication-email") throw new Error("unexpected_job_wake_lane");
    await dispatch(input.compose(bindings, wake));
  };
}

export function createCloudflareJobsDrains<Bindings>(input: Readonly<{
  handlers: Partial<Record<CloudflareJobWakeLane, CloudflareJobHandler<Bindings>>>;
  scheduled: readonly CloudflareScheduledDrain<Bindings>[];
  retryDelaySeconds?: number;
}>): CloudflareJobsDrains<Bindings, unknown> {
  const retryDelaySeconds = input.retryDelaySeconds ?? 30;
  return {
    async drainQueue({ batch, bindings, context }) {
      for (const message of batch.messages) {
        let wake: CloudflareJobWake;
        try {
          wake = parseCloudflareJobWake(message.body);
        } catch {
          message.ack();
          continue;
        }
        const handler = input.handlers[wake.lane];
        if (!handler) {
          message.retry({ delaySeconds: retryDelaySeconds });
          continue;
        }
        try {
          await handler(wake, bindings, context);
          message.ack();
        } catch {
          message.retry({ delaySeconds: retryDelaySeconds });
        }
      }
    },
    async drainScheduled({ controller, bindings, context }) {
      for (const drain of input.scheduled) await drain(controller, bindings, context);
    },
  };
}
