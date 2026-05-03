# syntax=docker/dockerfile:1.7

# Build the Linux AMD64 GNU ecvrf-cli binary and export it back to this folder:
#
#   docker buildx build --platform linux/amd64 --target artifact --output type=local,dest=. .
#
# The command above writes ./ecvrf-cli, which standalone-vrf-server.js checks first.

ARG RUST_VERSION=1

FROM --platform=linux/amd64 rust:${RUST_VERSION}-bookworm AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        pkg-config \
        build-essential && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY mangekyou ./mangekyou
COPY mangekyou-cli ./mangekyou-cli
COPY mangekyou-derive ./mangekyou-derive

ENV CARGO_TARGET_DIR=/app/target

RUN cargo build \
    --locked \
    --release \
    --target x86_64-unknown-linux-gnu \
    --package mangekyou-cli \
    --bin ecvrf-cli

RUN mkdir -p /out && \
    cp /app/target/x86_64-unknown-linux-gnu/release/ecvrf-cli /out/ecvrf-cli && \
    chmod 0755 /out/ecvrf-cli

FROM scratch AS artifact
COPY --from=builder /out/ecvrf-cli /ecvrf-cli
