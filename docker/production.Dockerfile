FROM node:18-alpine

WORKDIR /app

# Install OpenSSL
RUN apk add --no-cache openssl openssl-dev

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci

# Setup Prisma
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Generate Prisma Client again after copying all files
# This ensures the correct binary targets are included
RUN npx prisma generate

EXPOSE 8080

CMD ["npm", "start"] 