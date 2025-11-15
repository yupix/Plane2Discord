FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies from package.json
# We use --production to keep the image small. If you need dev deps, remove --production.
COPY package.json ./
RUN npm install --production --no-audit --no-fund

# Copy source
COPY . .

# Environment
ENV NODE_ENV=production

# Port the app listens on
EXPOSE 3000

# Use the npm start script defined in package.json
CMD ["npm", "start"]
