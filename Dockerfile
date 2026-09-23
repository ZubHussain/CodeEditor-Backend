# Use the official Docker CLI image with Node.js installed on Alpine
FROM node:18-alpine

# Install Docker CLI so the Node app can execute 'docker run' commands
RUN apk add --no-cache docker-cli

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose the application port
EXPOSE 8080

# Start the Node app
CMD ["node", "index.js"]