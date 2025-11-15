FROM denoland/deno:alpine-1.37.1

# Create app directory
WORKDIR /app

# Copy source
COPY . .

# Set environment defaults
ENV PORT=3000

# Expose port
EXPOSE 3000

# Run the Deno server with required permissions
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "--allow-write", "src/server.ts"]
