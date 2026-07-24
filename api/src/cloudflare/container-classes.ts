import {Container, ContainerProxy} from "@cloudflare/containers";

type ContainerBindings = Readonly<{
  TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS: string;
  THUMBNAIL_SLEEP_AFTER_SECONDS: string;
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

export class TrustedProcessingContainer extends PrivateShareSlicesContainer {
  constructor(
    ...args: ConstructorParameters<typeof Container<ContainerBindings>>
  ) {
    super(...args);
    this.sleepAfter = sleepAfterMilliseconds(
      "trusted_processing_sleep_after_seconds",
      args[1].TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS,
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
  }
}

export {ContainerProxy};
