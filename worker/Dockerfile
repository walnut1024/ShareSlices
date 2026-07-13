FROM rust:1.96.1-bookworm AS build

WORKDIR /workspace

COPY Cargo.toml Cargo.lock ./
COPY worker/Cargo.toml worker/Cargo.toml
COPY cli/Cargo.toml cli/Cargo.toml
RUN mkdir -p worker/src cli/src \
    && printf 'fn main() {}\n' > worker/src/main.rs \
    && printf 'fn main() {}\n' > cli/src/main.rs \
    && cargo build --release --locked --package shareslices-worker

COPY worker/ worker/
RUN touch worker/src/main.rs && cargo build --release --locked --package shareslices-worker

FROM debian:bookworm-slim AS runtime

ARG CHROMIUM_VERSION=150.0.7871.114-1~deb12u1
RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
        "chromium=${CHROMIUM_VERSION}" \
        "chromium-common=${CHROMIUM_VERSION}" \
        "chromium-sandbox=${CHROMIUM_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 shareslices \
    && useradd --system --uid 10001 --gid shareslices --home-dir /nonexistent --shell /bin/false shareslices \
    && install --directory --owner=shareslices --group=shareslices /tmp/shareslices

COPY --from=build --chown=shareslices:shareslices /workspace/target/release/shareslices-worker /usr/local/bin/shareslices-worker

ENV HOME=/tmp/shareslices
USER shareslices

ENTRYPOINT ["shareslices-worker"]
