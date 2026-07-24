import {Container, ContainerProxy} from "@cloudflare/containers";

type ContainerBindings = Readonly<{
  TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS: string;
  THUMBNAIL_SLEEP_AFTER_SECONDS: string;
  TRUSTED_PROCESSING_IMAGE_BUILD_IDENTITY: string;
  THUMBNAIL_IMAGE_BUILD_IDENTITY: string;
  CONTAINER_RELEASE_ID: string;
  CONTAINER_CONTRACT_REVISION: string;
}>;

function sleepAfterMilliseconds(name: string, value: string): number {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`invalid_cloudflare_binding_${name}`);
  }
  return seconds * 1_000;
}

abstract class PrivateShareSlicesContainer extends Container<ContainerBindings> {
  defaultPort = 8080;
  enableInternet = false;
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
  }
}

export class ThumbnailContainer extends PrivateShareSlicesContainer {
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
  }
}

export {ContainerProxy};
