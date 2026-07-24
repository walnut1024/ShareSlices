import {
  Container,
  ContainerProxy,
  type StopParams,
} from "@cloudflare/containers";

type ContainerBindings = Readonly<{
  TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS: string;
  THUMBNAIL_SLEEP_AFTER_SECONDS: string;
  TRUSTED_PROCESSING_MAXIMUM_CLAIMS_PER_DRAIN: string;
  THUMBNAIL_MAXIMUM_CLAIMS_PER_DRAIN: string;
  TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS: string;
  THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS: string;
  TRUSTED_PROCESSING_IMAGE_BUILD_IDENTITY: string;
  THUMBNAIL_IMAGE_BUILD_IDENTITY: string;
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

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/wake") {
      return new Response("Not found", {status: 404});
    }
    await this.start({
      enableInternet: this.enableInternet,
      entrypoint: this.drainEntrypoint,
      envVars: this.envVars,
    });
    return new Response(null, {status: 202});
  }

  override async onActivityExpired(): Promise<void> {
    await this.stop("SIGTERM");
  }

  override async onStop({exitCode, reason}: StopParams): Promise<void> {
    if (reason === "exit" && exitCode === REMAINING_WORK_EXIT_CODE) {
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
  protected readonly drainEntrypoint: string[];

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
    this.drainEntrypoint = containerDrainEntrypoint({
      lane: "thumbnail",
      maximumClaims: args[1].THUMBNAIL_MAXIMUM_CLAIMS_PER_DRAIN,
      maximumWallTimeSeconds: args[1].THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS,
    });
  }
}

export {ContainerProxy};
