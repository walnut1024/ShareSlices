FROM rust:1.96.1-bookworm AS build

WORKDIR /workspace

COPY Cargo.toml Cargo.lock ./
COPY worker/Cargo.toml worker/Cargo.toml
RUN mkdir -p worker/src && printf 'fn main() {}\n' > worker/src/main.rs && cargo build --release --locked --package shareslices-worker

COPY worker/ worker/
RUN touch worker/src/main.rs && cargo build --release --locked --package shareslices-worker

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 shareslices \
    && useradd --system --uid 10001 --gid shareslices --home-dir /nonexistent --shell /bin/false shareslices

COPY --from=build --chown=shareslices:shareslices /workspace/target/release/shareslices-worker /usr/local/bin/shareslices-worker

USER shareslices

ENTRYPOINT ["shareslices-worker"]
