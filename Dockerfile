# Use the latest Deno Alpine image to ensure lockfile compatibility
FROM denoland/deno:alpine

# Use /app as working directory
WORKDIR /app

# Copy only manifest and lock files first (if present) to leverage Docker layer cache for deps
COPY deno.json deno.lock* ./  
COPY src ./src

# Set a writable DENO_DIR inside the image so caching doesn't hit root-owned dirs
ENV DENO_DIR=/app/.deno
RUN mkdir -p /app/.deno && chown -R deno:deno /app/.deno

# Pre-cache dependencies to speed up container start and take advantage of layer caching
RUN deno cache src/server.ts

# Copy remaining files (if any)

COPY . .

# Set non-root user (the official image includes 'deno' user)
USER deno

# Default port
ENV PORT=3000

EXPOSE 3000

# Run the Deno server with necessary permissions
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "--allow-write", "src/server.ts"]
