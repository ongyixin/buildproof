#!/usr/bin/env bash
# =============================================================================
# BuildProof — One-Command Demo Startup
# =============================================================================
#
# Starts the full BuildProof local demo stack:
#   1. 3 miner neurons (task-specialised):
#        miner1 → rubric_scorer        (port 8101) — OpenAI backend
#        miner2 → diligence_generator  (port 8102) — rule-based + optional Anthropic
#        miner3 → risk_detector        (port 8103) — rule-based + optional LLM
#   2. 1 validator neuron        (queries miners, scores, sets weights)
#   3. FastAPI backend           (http://localhost:8000)
#
# Provider heterogeneity:
#   miner1 uses OpenAI (OPENAI_API_KEY required for full LLM scoring)
#   miner2 uses Anthropic (ANTHROPIC_API_KEY optional) or falls back to rule-based
#   miner3 is primarily rule-based (no API key required)
#
# Global API toggle:
#   ENABLE_EXTERNAL_API_CALLS=false disables all outbound OpenAI/Anthropic calls
#   and forces fallback/mock behavior in miners.
#
# Frontend is NOT started here — run it in a separate terminal:
#   cd frontend && npm install && npm run dev
#
# Prerequisites:
#   - scripts/setup_localnet.sh completed successfully
#   - Python virtualenv is active (or deps are installed globally)
#   - Local subtensor chain is running (Docker container: buildproof-subtensor)
#
# Logs:  ./logs/<component>.log
# PIDs:  ./logs/<component>.pid   (used by stop_demo.sh)
# =============================================================================

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
CHAIN_ENDPOINT="ws://127.0.0.1:9944"
NETUID=1
LOG_DIR="logs"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "\033[0;36m[run_demo]\033[0m $*"; }
ok()   { echo -e "\033[0;32m[  ok]\033[0m $*"; }
warn() { echo -e "\033[0;33m[ warn]\033[0m $*"; }
die()  { echo -e "\033[0;31m[ fail]\033[0m $*" >&2; exit 1; }

start_bg() {
  local label=$1; shift
  local logfile="${LOG_DIR}/${label}.log"
  local pidfile="${LOG_DIR}/${label}.pid"

  log "Starting ${label} → ${logfile}"
  (cd "${REPO_ROOT}" && exec nohup "$@" >"${logfile}" 2>&1) &
  local pid=$!
  echo "${pid}" > "${pidfile}"
  ok "  ${label} started (PID ${pid})"
}

# Ensure all Python processes can resolve top-level packages (api, buildproof,
# miners, etc.) regardless of which subdirectory they run from.
export PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"

# ── Preflight checks ─────────────────────────────────────────────────────────
cd "${REPO_ROOT}"

log "Running preflight checks…"

command -v python >/dev/null 2>&1  || die "python not found. Activate your virtualenv."
command -v uvicorn >/dev/null 2>&1 || die "uvicorn not found. Run: pip install -r requirements.txt"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  warn "OPENAI_API_KEY not set. Rubric scorer will use seeded fallback."
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  warn "ANTHROPIC_API_KEY not set. Diligence generator will use rule-based only."
fi
if [[ "${ENABLE_EXTERNAL_API_CALLS:-true}" =~ ^(false|FALSE|0|no|NO|off|OFF)$ ]]; then
  warn "ENABLE_EXTERNAL_API_CALLS=false. All external LLM calls are disabled; miners will use fallback/mock paths."
fi
log "Risk detector runs rule-based by default (no API key required)."

if ! docker ps --format '{{.Names}}' | grep -q '^buildproof-subtensor$'; then
  die "Local subtensor chain not running. Run: bash scripts/setup_localnet.sh"
fi

ok "Preflight OK"

# ── Create log directory ─────────────────────────────────────────────────────
mkdir -p "${LOG_DIR}"

# ── Stop any previously running demo processes ───────────────────────────────
log "Stopping any previously running demo processes…"
for pidfile in "${LOG_DIR}"/*.pid; do
  [[ -f "${pidfile}" ]] || continue
  pid=$(cat "${pidfile}" 2>/dev/null) || continue
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null
    # Give it 3 s to exit gracefully, then force-kill
    for _ in 1 2 3; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 1
    done
    kill -9 "${pid}" 2>/dev/null || true
    log "  Killed PID ${pid} ($(basename "${pidfile}" .pid))"
  fi
  rm -f "${pidfile}"
done

# Also forcibly free port 8000 in case a previous api process survived outside
# the PID-file tracking (e.g. script was killed before writing the PID file).
if lsof -ti :8000 >/dev/null 2>&1; then
  warn "Port 8000 still in use — force-killing occupant(s)…"
  kill -9 $(lsof -ti :8000) 2>/dev/null || true
  sleep 1
fi

sleep 1

# ── 1. Miners (3 distinct capabilities) ─────────────────────────────────────

log "Launching miner1 — rubric_scorer (port 8101, OpenAI backend)…"
start_bg "miner_rubric_scorer" \
  python neurons/miner.py \
    --netuid                      "${NETUID}" \
    --subtensor.network           local \
    --subtensor.chain_endpoint    "${CHAIN_ENDPOINT}" \
    --wallet.name                 miner1 \
    --wallet.hotkey               default \
    --axon.port                   8101 \
    --miner.strategy              rubric_scorer \
    --logging.debug

log "Launching miner2 — diligence_generator (port 8102, rule-based + Anthropic)…"
start_bg "miner_diligence_generator" \
  python neurons/miner.py \
    --netuid                      "${NETUID}" \
    --subtensor.network           local \
    --subtensor.chain_endpoint    "${CHAIN_ENDPOINT}" \
    --wallet.name                 miner2 \
    --wallet.hotkey               default \
    --axon.port                   8102 \
    --miner.strategy              diligence_generator \
    --logging.debug

log "Launching miner3 — risk_detector (port 8103, rule-based + optional LLM)…"
start_bg "miner_risk_detector" \
  python neurons/miner.py \
    --netuid                      "${NETUID}" \
    --subtensor.network           local \
    --subtensor.chain_endpoint    "${CHAIN_ENDPOINT}" \
    --wallet.name                 miner3 \
    --wallet.hotkey               default \
    --axon.port                   8103 \
    --miner.strategy              risk_detector \
    --logging.debug

log "Waiting 10 s for miner axons to serve on-chain…"
sleep 10

# ── 2. Validator ─────────────────────────────────────────────────────────────
# The validator:
#   - Claims proposals from DB (status='queued' → 'processing')
#   - Queries each miner with its designated task_type
#   - Scores with task-specific reward model + anti-gaming penalties
#   - Writes results back to DB (status → 'complete')
#   - Sets weights on chain every epoch_length steps

log "Launching validator…"
start_bg "validator" \
  python neurons/validator.py \
    --netuid                      "${NETUID}" \
    --subtensor.network           local \
    --subtensor.chain_endpoint    "${CHAIN_ENDPOINT}" \
    --wallet.name                 validator \
    --wallet.hotkey               default \
    --neuron.benchmarks_dir       benchmarks \
    --neuron.epoch_length         5 \
    --neuron.sample_size          3 \
    --neuron.timeout              60.0 \
    --logging.debug

# ── 3. FastAPI ───────────────────────────────────────────────────────────────

log "Launching FastAPI on port 8000…"
start_bg "api" \
  uvicorn api.main:app \
    --host 0.0.0.0 \
    --port 8000

# ── 4. Wait for API health ───────────────────────────────────────────────────
log "Waiting for FastAPI to become healthy…"
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "API is up — http://localhost:8000/health"
    break
  fi
  if [[ "${i}" -eq 30 ]]; then
    warn "API did not respond in 30 s. Check logs/api.log for errors."
  fi
  sleep 1
done

# ── 5. Seed benchmarks ───────────────────────────────────────────────────────
log "Seeding benchmark proposals (8 gold + 7 adversarial)…"
curl -sf -X POST http://localhost:8000/benchmarks/run \
  -H "Content-Type: application/json" \
  -d '{"include_adversarial": true}' \
  | python -c "import sys, json; d=json.load(sys.stdin); print(f'  Enqueued: {d[\"enqueued\"]} | Already done: {d[\"already_complete\"]}')" \
  2>/dev/null \
  || warn "Could not seed benchmarks (API may still be starting). Retry via POST /benchmarks/run."

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔═════════════════════════════════════════════════════════════╗"
echo "║           BuildProof Demo Stack is Running                 ║"
echo "╠═════════════════════════════════════════════════════════════╣"
echo "║  Miner 1 (rubric_scorer)        → port 8101  [OpenAI]     ║"
echo "║  Miner 2 (diligence_generator)  → port 8102  [rule-based] ║"
echo "║  Miner 3 (risk_detector)        → port 8103  [rule-based] ║"
echo "║  Validator                       → DB queue + metagraph    ║"
echo "╠═════════════════════════════════════════════════════════════╣"
echo "║  FastAPI (backend)      →  http://localhost:8000           ║"
echo "║  API docs (Swagger)     →  http://localhost:8000/docs      ║"
echo "║  Health check           →  http://localhost:8000/health    ║"
echo "╠═════════════════════════════════════════════════════════════╣"
echo "║  START FRONTEND (separate terminal):                       ║"
echo "║    cd frontend && npm install && npm run dev               ║"
echo "║  Frontend dashboard     →  http://localhost:3000           ║"
echo "╠═════════════════════════════════════════════════════════════╣"
echo "║  Logs                   →  ./logs/<component>.log          ║"
echo "║  Stop everything        →  bash scripts/stop_demo.sh       ║"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""
log "Tailing validator + API logs (Ctrl+C stops watching — demo keeps running)."
echo ""

tail -f "${LOG_DIR}/validator.log" "${LOG_DIR}/api.log"
