FROM rust:1.86-bookworm AS fastcrypto-builder

ARG FASTCRYPTO_VALIDATED_REF=c141d4c2d52efe18d2b9193b071fdc188411da3b

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libssl-dev pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/fastcrypto
COPY FASTCRYPTO_VALIDATED_REF /tmp/FASTCRYPTO_VALIDATED_REF
COPY fastcrypto /tmp/fastcrypto
RUN test "$(tr -d '\n' < /tmp/FASTCRYPTO_VALIDATED_REF)" = "${FASTCRYPTO_VALIDATED_REF}"
RUN cargo build --locked --release --bin ecvrf-cli

FROM node:20-bookworm-slim AS node-builder

WORKDIR /app
COPY node/package.json node/package.json
COPY node/tsconfig.json node/tsconfig.json
COPY node/src node/src

RUN cd node \
  && npm install \
  && npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ARG FASTCRYPTO_VALIDATED_REF=c141d4c2d52efe18d2b9193b071fdc188411da3b

# Install AWS CLI v2 — used by OPERATOR_KEY_COMMAND / VRF_KEYPAIR_COMMAND
# when the container runs on an EC2 instance with an IAM instance profile.
# Authentication is handled entirely via the instance profile (no long-lived credentials).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && curl -sL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip \
  && unzip -q /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /tmp/aws /tmp/awscliv2.zip \
  && apt-get remove -y unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/node

COPY --from=node-builder /app/node/package.json ./package.json
COPY --from=node-builder /app/node/node_modules ./node_modules
COPY --from=node-builder /app/node/dist ./dist
COPY --from=fastcrypto-builder /tmp/fastcrypto/target/release/ecvrf-cli /usr/local/bin/ecvrf-cli

RUN mkdir -p /var/lib/kamui-iota-vrf/state \
  && chown -R node:node /app/node /var/lib/kamui-iota-vrf

ENV FASTCRYPTO_CLI_PATH=/usr/local/bin/ecvrf-cli
ENV FASTCRYPTO_VALIDATED_REF=${FASTCRYPTO_VALIDATED_REF}
ENV STATE_DIR=/var/lib/kamui-iota-vrf/state
ENV OPS_HOST=127.0.0.1
ENV OPS_PORT=9464

USER node

EXPOSE 9464

CMD ["node", "dist/index.js"]
