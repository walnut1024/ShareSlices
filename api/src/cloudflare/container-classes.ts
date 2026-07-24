import {
  Container,
  ContainerProxy,
  type StopParams,
} from "@cloudflare/containers";
import {createDatabaseConnection} from "../db/connection.js";
import type {R2BucketBinding} from "../storage/r2-object-storage.js";
import {createCloudflareThumbnailExecutionBroker} from "./thumbnail-execution-broker.js";

type ContainerBindings = Readonly<{
  HYPERDRIVE: Readonly<{connectionString: string}>;
  ARTIFACTS: R2BucketBinding;
  TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS: string;
  THUMBNAIL_SLEEP_AFTER_SECONDS: string;
  TRUSTED_PROCESSING_MAXIMUM_CLAIMS_PER_DRAIN: string;
  THUMBNAIL_MAXIMUM_CLAIMS_PER_DRAIN: string;
  TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS: string;
  THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS: string;
  TRUSTED_PROCESSING_IMAGE_BUILD_IDENTITY: string;
  THUMBNAIL_IMAGE_BUILD_IDENTITY: string;
  ARTIFACT_RENDERER_REVISION: string;
  CONTAINER_RELEASE_ID: string;
  CONTAINER_CONTRACT_REVISION: string;
}>;

const REMAINING_WORK_EXIT_CODE = 75;

function sleepAfterMilliseconds(name: string, value: string): number {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`invalid_cloudflare_binding_${name}`);
  }
  return seconds * 1_000;
}

export function containerDrainEntrypoint(input: Readonly<{
  lane: "artifact-processing" | "thumbnail";
  maximumClaims: string;
  maximumWallTimeSeconds: string;
}>): string[] {
  const maximumClaims = sleepAfterMilliseconds(
    "maximum_claims_per_drain",
    input.maximumClaims,
  ) / 1_000;
  const maximumWallTimeSeconds = sleepAfterMilliseconds(
    "maximum_wall_time_seconds",
    input.maximumWallTimeSeconds,
  ) / 1_000;
  return [
    "shareslices-worker",
    "drain",
    "--lanes",
    input.lane,
    "--maximum-claims",
    String(maximumClaims),
    "--maximum-idle-observations",
    "1",
    "--wall-time-seconds",
    String(maximumWallTimeSeconds),
  ];
}

abstract class PrivateShareSlicesContainer extends Container<ContainerBindings> {
  enableInternet = false;
  protected abstract readonly drainEntrypoint: string[];
  protected readonly restartOnRemainingWork: boolean = true;
  protected startEnvironment(_payload: unknown): Record<string, string> {
    return this.envVars;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/wake") {
      return new Response("Not found", {status: 404});
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid wake", {status: 400});
    }
    await this.start({
      enableInternet: this.enableInternet,
      entrypoint: this.drainEntrypoint,
      envVars: this.startEnvironment(payload),
    });
    return new Response(null, {status: 202});
  }

  override async onActivityExpired(): Promise<void> {
    await this.stop("SIGTERM");
  }

  override async onStop({exitCode, reason}: StopParams): Promise<void> {
    if (
      this.restartOnRemainingWork &&
      reason === "exit" &&
      exitCode === REMAINING_WORK_EXIT_CODE
    ) {
      await this.start({
        enableInternet: this.enableInternet,
        entrypoint: this.drainEntrypoint,
        envVars: this.envVars,
      });
    }
  }
}

function embeddedIdentity(
  env: ContainerBindings,
  imageBuildIdentity: string,
  containerClass: string,
) {
  return {
    SHARESLICES_CONTAINER_BUILD_IDENTITY: imageBuildIdentity,
    SHARESLICES_CONTAINER_RELEASE_ID: env.CONTAINER_RELEASE_ID,
    SHARESLICES_CONTAINER_CONTRACT_REVISION: env.CONTAINER_CONTRACT_REVISION,
    SHARESLICES_CONTAINER_CLASS: containerClass,
  };
}

export class TrustedProcessingContainer extends PrivateShareSlicesContainer {
  protected readonly drainEntrypoint: string[];

  constructor(
    ...args: ConstructorParameters<typeof Container<ContainerBindings>>
  ) {
    super(...args);
    this.sleepAfter = sleepAfterMilliseconds(
      "trusted_processing_sleep_after_seconds",
      args[1].TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS,
    );
    this.envVars = embeddedIdentity(
      args[1],
      args[1].TRUSTED_PROCESSING_IMAGE_BUILD_IDENTITY,
      "trusted-processing",
    );
    this.drainEntrypoint = containerDrainEntrypoint({
      lane: "artifact-processing",
      maximumClaims: args[1].TRUSTED_PROCESSING_MAXIMUM_CLAIMS_PER_DRAIN,
      maximumWallTimeSeconds:
        args[1].TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS,
    });
  }
}

export class ThumbnailContainer extends PrivateShareSlicesContainer {
  static override outboundByHost = {
    "shareslices-broker.internal": async (
      request: Request,
      env: ContainerBindings,
      context: Readonly<{containerId: string}>,
    ) => {
      const connection = createDatabaseConnection({
        mode: "hyperdrive",
        cache: "disabled",
        connectionString: env.HYPERDRIVE.connectionString,
        maxConnections: 1,
        connectionTimeoutMs: 5_000,
        idleTimeoutMs: 1_000,
      });
      try {
        const trustedRequest = new Request(request);
        trustedRequest.headers.set(
          "x-shareslices-container-id",
          context.containerId,
        );
        return await createCloudflareThumbnailExecutionBroker({
          connection,
          bucket: env.ARTIFACTS,
          leaseSeconds: sleepAfterMilliseconds(
            "thumbnail_maximum_wall_time_seconds",
            env.THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS,
          ) / 1_000,
        }).fetch(trustedRequest);
      } finally {
        await connection.close();
      }
    },
  };

  protected override readonly restartOnRemainingWork = false;
  protected readonly drainEntrypoint = [
    "shareslices-worker",
    "thumbnail-broker",
  ];

  constructor(
    ...args: ConstructorParameters<typeof Container<ContainerBindings>>
  ) {
    super(...args);
    this.sleepAfter = sleepAfterMilliseconds(
      "thumbnail_sleep_after_seconds",
      args[1].THUMBNAIL_SLEEP_AFTER_SECONDS,
    );
    this.envVars = embeddedIdentity(
      args[1],
      args[1].THUMBNAIL_IMAGE_BUILD_IDENTITY,
      "thumbnail",
    );
    this.envVars.SHARESLICES_ARTIFACT_RENDERER_REVISION =
      args[1].ARTIFACT_RENDERER_REVISION;
  }

  protected override startEnvironment(payload: unknown): Record<string, string> {
    const bootstrapGrant = (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "bootstrapGrant" in payload
    )
      ? (payload as {bootstrapGrant?: unknown}).bootstrapGrant
      : undefined;
    if (
      typeof bootstrapGrant !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(bootstrapGrant)
    ) {
      throw new Error("thumbnail_bootstrap_grant_invalid");
    }
    return {
      ...this.envVars,
      SHARESLICES_THUMBNAIL_BOOTSTRAP_GRANT: bootstrapGrant,
      SHARESLICES_THUMBNAIL_BROKER_ORIGIN: "http://shareslices-broker.internal",
    };
  }
}

export {ContainerProxy};
