# Frontend Dockerfile for AgentWiki (React + Vite)
ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:alpine
FROM ${NODE_IMAGE} AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/client/package.json ./apps/client/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/client ./apps/client
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# Build shared contracts before compiling the application.
RUN pnpm --filter @agentwiki/shared build && pnpm --filter @agentwiki/client build

# Production stage - serve with nginx
FROM ${NGINX_IMAGE}

# Copy built files
COPY --from=builder /app/apps/client/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/client/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
