FROM node:22 as builder
ARG BUILD_CONTEXT
WORKDIR /builder
COPY package.json .
COPY yarn.lock .
COPY tsconfig.json .
COPY src .
RUN yarn install
RUN yarn build

FROM node:22-slim
WORKDIR /app
RUN chown node:node /app
COPY --from=builder --chown=node:node /builder/dist ./dist
COPY --from=builder --chown=node:node /builder/node_modules ./node_modules
COPY --from=builder --chown=node:node /builder/package.json .
USER node
CMD [ "node", "--no-warnings", "--enable-source-maps",  "dist/index.js" ]
