FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/prompt-sync-api/package.json apps/prompt-sync-api/package.json
COPY packages/prompt-builder-contracts/package.json packages/prompt-builder-contracts/package.json

RUN npm install

COPY apps/prompt-sync-api apps/prompt-sync-api
COPY packages/prompt-builder-contracts packages/prompt-builder-contracts

RUN npm --workspace @rapid-prompt/prompt-sync-api run build

EXPOSE 8080
CMD ["npm", "--workspace", "@rapid-prompt/prompt-sync-api", "run", "start"]
