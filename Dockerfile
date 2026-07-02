FROM node:22-slim AS build
WORKDIR /app

# Explicit copy — glob can miss lockfile on some builders
COPY package.json package-lock.json ./

RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
