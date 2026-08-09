# Backend Dockerfile for AgentWiki (NestJS)
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS builder

# Install pnpm and build tools
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy workspace config files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# Generate Prisma client before build
RUN cd apps/server && npx prisma generate

# Build shared contracts before compiling the application.
RUN pnpm --filter @agentwiki/shared build && pnpm --filter @agentwiki/server build

# Production stage
FROM ${NODE_IMAGE} AS production

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy Prisma schema for migrations
COPY apps/server/prisma ./apps/server/prisma

WORKDIR /app/apps/server

# Generate Prisma client in production
RUN npx prisma generate

USER node

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "dist/main.js"]
