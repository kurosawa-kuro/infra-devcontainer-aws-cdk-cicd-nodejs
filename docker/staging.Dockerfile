FROM node:18-alpine

WORKDIR /app

# Install production dependencies first
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Set production environment
ENV NODE_ENV=production \
    APP_ENV=production

# Start the application
CMD ["npm", "staging"]