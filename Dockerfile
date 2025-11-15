## Multi-stage Node + pnpm Dockerfile
## Builder: install dependencies and compile TypeScript
FROM node:24-alpine AS builder

# Enable corepack and pnpm
RUN corepack enable && corepack prepare pnpm@8.7.0 --activate

WORKDIR /app

# Copy package manifests first for better caching
COPY package.json pnpm-lock.yaml tsconfig.json ./

# Install dependencies (including dev deps for build)
RUN pnpm install --frozen-lockfile

# Copy full source and build
COPY . .
RUN pnpm run build

## Runner: smaller runtime image
FROM node:24-alpine AS runner

# Activate corepack/pnpm in the runtime image (optional, but keeps behavior consistent)
RUN corepack enable && corepack prepare pnpm@8.7.0 --activate

WORKDIR /app

# Copy runtime artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run the compiled server
CMD ["node", "dist/server.js"]
