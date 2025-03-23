FROM node:22 as builder
ARG BUILD_CONTEXT
WORKDIR /builder

# Install git
RUN apt-get update && apt-get install -y git

# Clone mangekyou repository for the rust library
RUN git clone https://github.com/mangekyou-labs/kamui.git

COPY package.json .
COPY yarn.lock .
COPY tsconfig.json .
COPY src .
RUN yarn install
RUN yarn build

FROM node:22-slim
WORKDIR /app

# Install git and necessary dependencies
RUN apt-get update && apt-get install -y git

# Clone mangekyou repository in the final image as well
RUN git clone https://github.com/mangekyou-labs/kamui.git

RUN chown node:node /app
COPY --from=builder --chown=node:node /builder/dist ./dist
COPY --from=builder --chown=node:node /builder/node_modules ./node_modules
COPY --from=builder --chown=node:node /builder/package.json .
COPY --from=builder --chown=node:node /builder/keypair.json .
COPY --from=builder --chown=node:node /builder/vrf-keypair.json .

USER node
CMD [ "node", "--no-warnings", "--enable-source-maps",  "dist/index.js" ]
