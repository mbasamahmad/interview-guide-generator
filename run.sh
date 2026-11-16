#!/usr/bin/env bash
# Start the Interview Guide Generator.
#
#   ./run.sh                 development server on port 3000 (hot reload)
#   ./run.sh prod            production build, then start
#   ./run.sh dev -p 4000     choose a port
#   ./run.sh --help
set -euo pipefail

cd "$(dirname "$0")"

MODE="dev"
PORT="4000"

usage() {
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    dev|prod) MODE="$1"; shift ;;
    -p|--port)
      [[ $# -ge 2 ]] || { echo "Error: $1 needs a port number." >&2; exit 1; }
      PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "Error: port must be a number (got '$PORT')." >&2; exit 1; }

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Node.js 20 or newer
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 20+ (https://nodejs.org) and try again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || fail "Node.js 20+ is required (found $(node -v))."

# 2. Dependencies: install when missing or when package-lock.json changed since the last install
if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  info "Installing dependencies…"
  npm install --no-audit --no-fund
fi

# 3. API keys
if [[ ! -f .env.local ]]; then
  cp .env.local.example .env.local
  warn "Created .env.local from .env.local.example. Add an API key for each provider your agents use, then restart."
fi

has_key() {
  local name="$1"
  [[ -n "${!name:-}" ]] && return 0
  grep -Eq "^${name}=[^[:space:]]+" .env.local 2>/dev/null
}
CONFIGURED=()
has_key ANTHROPIC_API_KEY && CONFIGURED+=("Claude")
has_key OPENAI_API_KEY && CONFIGURED+=("OpenAI")
{ has_key GEMINI_API_KEY || has_key GOOGLE_API_KEY; } && CONFIGURED+=("Gemini")
if (( ${#CONFIGURED[@]} == 0 )); then
  warn "No API keys found in .env.local. The app will start, but runs will fail until you add ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY."
else
  info "API keys found for: ${CONFIGURED[*]}"
fi

# 4. Port must be free
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $PORT is already in use. Stop that process or choose another port: ./run.sh $MODE -p <port>"
fi

# 5. Start
if [[ "$MODE" == "prod" ]]; then
  # A production build rewrites .next, which a running dev server for this folder also uses.
  for pid in $(pgrep -f "next dev" 2>/dev/null || true); do
    if [[ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" == "$(pwd)" ]]; then
      fail "A dev server for this project is running (pid $pid). Stop it before building for production."
    fi
  done
  info "Building for production…"
  npx next build
  info "Starting on http://localhost:$PORT"
  exec npx next start -p "$PORT"
else
  info "Starting dev server on http://localhost:$PORT"
  info "Tip: for generating guides use ./run.sh prod. It uses far less memory and doesn't restart mid-run."
  exec npx next dev -p "$PORT"
fi
