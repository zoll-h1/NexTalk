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
RUN npm ci

COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

RUN npm ci --omit=dev

EXPOSE 3000

CMD ["npm", "run", "start"]
