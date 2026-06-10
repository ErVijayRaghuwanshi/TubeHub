# Stage 1: Build the React frontend
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production runner
FROM node:20-bookworm-slim
WORKDIR /app

# Install ffmpeg and python3 (required for yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production-only dependencies
COPY package*.json ./
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
RUN npm ci --only=production

# Copy server code and built frontend assets
COPY server.js ./
COPY --from=builder /app/dist ./dist

# Create downloads folder
RUN mkdir -p downloads

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
