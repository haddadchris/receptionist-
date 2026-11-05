# Voice server (Twilio webhooks + Media Streams WebSockets + job worker).
# Build from the repository root:  docker build -f apps/voice/Dockerfile -t fekerte-voice .
FROM node:22-slim
WORKDIR /app
RUN corepack enable
# Install only what the voice server needs (itself + @fekerte/core).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/voice/package.json apps/voice/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter "@fekerte/voice..."
COPY packages/core packages/core
COPY apps/voice apps/voice
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "@fekerte/voice", "start"]
