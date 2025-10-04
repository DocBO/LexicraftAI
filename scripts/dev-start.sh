#!/usr/bin/env bash
set -euo pipefail

# Keep the frontend on port 3001 to avoid the default CRA port clash.
FRONTEND_PORT=${FRONTEND_PORT:-3001}
BACKEND_HOST=${BACKEND_HOST:-127.0.0.1}
BACKEND_PORT=${BACKEND_PORT:-8000}
REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL:-http://$BACKEND_HOST:$BACKEND_PORT}

# Ensure background jobs get cleaned up on exit.
cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting FastAPI backend on ${BACKEND_HOST}:${BACKEND_PORT}"
uvicorn backend.app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID=$!

# Give uvicorn a moment to boot so the frontend can connect immediately.
sleep 1

echo "Starting React app on port ${FRONTEND_PORT} (REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL})"
PORT=$FRONTEND_PORT REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL npm start &
FRONTEND_PID=$!

wait -n "$BACKEND_PID" "$FRONTEND_PID"
