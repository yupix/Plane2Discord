## Multi-stage Node + pnpm Dockerfile
## Builder: install dependencies and compile TypeScript
FROM oven/bun:latest

# Enable corepack and pnpm
WORKDIR /app


# Copy package manifests first for better caching
COPY package.json tsconfig.json ./

# Install dependencies (including dev deps for build)
RUN bun install --production

# Copy full source and build
COPY . .

## Runner: smaller runtime image
ENV PORT=3000

# Activate corepack/pnpm in the runtime image (optional, but keeps behavior consistent)
EXPOSE 3000

CMD ["bun", "src/server.ts"]
