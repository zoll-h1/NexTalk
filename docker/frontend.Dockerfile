FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost/api/v1
ARG NEXT_PUBLIC_WS_URL=ws://localhost/ws
ARG NEXT_PUBLIC_TURN_SERVER=
ARG NEXT_PUBLIC_TURN_USER=
ARG NEXT_PUBLIC_TURN_PASS=

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_TURN_SERVER=$NEXT_PUBLIC_TURN_SERVER \
    NEXT_PUBLIC_TURN_USER=$NEXT_PUBLIC_TURN_USER \
    NEXT_PUBLIC_TURN_PASS=$NEXT_PUBLIC_TURN_PASS

COPY frontend/package.json frontend/package-lock.json ./
RUN npm install -g npm@latest && npm ci --prefer-offline || npm install

COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
