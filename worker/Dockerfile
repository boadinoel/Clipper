FROM node:20-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      ffmpeg \
      python3 \
      python3-pip \
      python3-venv \
      fonts-inter \
      fonts-noto-color-emoji \
      chromium \
      libnss3 \
      libatk-bridge2.0-0 \
      libxkbcommon0 \
      libgbm1 \
      libasound2 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip yt-dlp \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp

RUN python3 -m venv /opt/cv-venv \
    && /opt/cv-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/cv-venv/bin/pip install --no-cache-dir mediapipe opencv-python-headless numpy

ENV FACE_TRACK_PYTHON=/opt/cv-venv/bin/python3

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    REMOTION_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/remotion ./src/remotion
COPY scripts ./scripts

EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.js"]
