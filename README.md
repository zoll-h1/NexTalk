# NexTalk

Full-stack messenger with a FastAPI backend and Next.js frontend.

## What is finished

- Backend Phases 1-5
- Frontend parity for auth, chats, topics, messaging, attachments, notifications, unread counts, search, and basic calls
- Deployment preparation for Phase 6:
  - production Dockerfiles
  - `docker-compose.yml`
  - nginx reverse proxy
  - backend request logging and rate limiting
  - CI workflow

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Production-style (run with Docker)

1. Optional: copy the env examples if you want to override the compose defaults:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

2. Update secrets and URLs in the copied files, or export the same variables in your shell. The compose stack now has working defaults for a fresh checkout, but you should replace them before a real deployment.

3. Start the stack:

```bash
docker compose up --build
```

4. Open:

- App: `http://localhost`  <-----
- Backend health: `http://localhost/health`

## Deployment notes

- The backend adds `X-Request-ID` to HTTP responses and logs request metadata for easier tracing.
- Rate limiting is configurable with `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW_SECONDS`.
- nginx proxies `/`, `/api/`, and `/ws`.
- The frontend Docker image runs the production Next.js server.
