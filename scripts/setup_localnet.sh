#!/usr/bin/env bash
# =============================================================================
# BuildProof — Local Subtensor Setup
# =============================================================================
#
# What this script does (in order):
#   1. Starts a local Bittensor chain inside Docker (Alice/Bob dev node).
#   2. Creates five wallets: owner, validator, miner1, miner2, miner3.
#   3. Mints TAO for each wallet via the localnet faucet.
#   4. Has the owner create subnet netuid=1.
#   5. Registers all four neurons (validator + 3 miners) on that subnet.
#   6. Stakes the validator so it receives a validator_permit — miners use
#      this permit in their blacklist() check before accepting dendrite queries.
#
# Run this ONCE before scripts/run_demo.sh.
# Safe to re-run; wallet creation and registration are idempotent.
#
# Prerequisites:
#   - Docker Desktop is running
#   - btcli is installed:  pip install bittensor
#   - Python 3.10+ with bittensor package available
#
# Local chain endpoint: ws://127.0.0.1:9944
# Subnet netuid: 1
# =============================================================================

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
CHAIN_ENDPOINT="ws://127.0.0.1:9944"
NETUID=1
CONTAINER_NAME="buildproof-subtensor"
DOCKER_IMAGE="ghcr.io/opentensor/subtensor-localnet:devnet-ready"

# Approximate TAO cost to create subnet + register 4 neurons on localnet.
# Faucet drips 100 TAO per call; two drips = 200 TAO, more than enough.
FAUCET_DRIPS=2

# ── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "\033[0;36m[setup]\033[0m $*"; }
ok()   { echo -e "\033[0;32m[  ok]\033[0m $*"; }
warn() { echo -e "\033[0;33m[warn]\033[0m $*"; }
die()  { echo -e "\033[0;31m[fail]\033[0m $*" >&2; exit 1; }

# ── 0. Prerequisite checks ───────────────────────────────────────────────────
log "Checking prerequisites…"
command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Desktop from https://docker.com"
command -v btcli  >/dev/null 2>&1 || die "btcli not found. Run: pip install bittensor"
docker info >/dev/null 2>&1       || die "Docker daemon not running. Start Docker Desktop."
ok "Prerequisites OK"

# ── 1. Start local subtensor chain ───────────────────────────────────────────
log "Starting local subtensor chain…"

# Remove any stale container from a previous run (makes this idempotent).
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  warn "Removing existing container '${CONTAINER_NAME}'…"
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

# subtensor-localnet:devnet-ready is the purpose-built local dev image.
# It runs two Alice/Bob nodes internally and produces blocks at 250 ms.
# No extra flags needed — the image handles everything.
# Passing "True" as the first arg enables fast-block mode (250 ms).
docker run -d \
  --name  "${CONTAINER_NAME}" \
  -p 9944:9944 \
  -p 9945:9945 \
  --platform linux/amd64 \
  "${DOCKER_IMAGE}" \
  True

# Wait until the JSON-RPC server responds (not just TCP open) — up to 60 s.
log "Waiting for chain JSON-RPC to become ready…"
CHAIN_READY=0
for i in $(seq 1 60); do
  RESULT=$(curl -sf -X POST http://127.0.0.1:9944 \
    -H "Content-Type: application/json" \
    -d '{"id":1,"jsonrpc":"2.0","method":"system_chain","params":[]}' \
    2>/dev/null || true)
  if echo "${RESULT}" | grep -q '"result"'; then
    CHAIN_READY=1
    break
  fi
  sleep 1
done
if [[ "${CHAIN_READY}" -eq 0 ]]; then
  die "Chain RPC did not become ready after 60 s. Check: docker logs ${CONTAINER_NAME}"
fi
log "Chain RPC ready after ${i} s."

ok "Local chain running on ${CHAIN_ENDPOINT}"

# ── 2. Create wallets ────────────────────────────────────────────────────────
# Wallets live in ~/.bittensor/wallets/<name>/
# Each wallet has one coldkey + one hotkey named "default".
log "Creating wallets (owner, validator, miner1, miner2, miner3)…"

create_wallet() {
  local name=$1
  # Use the bittensor_wallet Python library directly — btcli v9 wallet
  # creation is interactive (prompts for mnemonic word count, path, etc.)
  # and cannot be fully suppressed via flags. The Python API is idempotent
  # (overwrite=False) and requires zero interaction.
  python - <<PYEOF
import bittensor_wallet as btw, sys
try:
    w = btw.Wallet(name="${name}", hotkey="default")
    w.create(coldkey_use_password=False, hotkey_use_password=False,
             overwrite=False, suppress=True)
    print("[setup]   Created wallet: ${name}")
except Exception as e:
    msg = str(e)
    if "already" in msg.lower() or "exist" in msg.lower():
        print("[warn]    Wallet '${name}' already exists — skipping.")
    else:
        print(f"[warn]    ${name}: {msg}", file=sys.stderr)
PYEOF
}

create_wallet owner
create_wallet validator
create_wallet miner1
create_wallet miner2
create_wallet miner3

ok "All wallets ready."

# ── 3. Fund wallets via Alice (dev account) ──────────────────────────────────
# btcli wallet faucet does slow Proof-of-Work even on localnet.
# The --dev chain pre-funds Alice (//Alice) with unlimited TAO.
# We use the Python SDK to transfer 1500 TAO from Alice to each wallet's
# coldkey address — fast, no PoW, works on any Bittensor devnet.
log "Funding wallets from Alice dev account (1500 TAO each)…"

python - <<'PYEOF'
import bittensor as bt
import bittensor_wallet as btw
import sys

CHAIN = "ws://127.0.0.1:9944"
AMOUNT = 1500  # TAO per wallet — enough for subnet creation + registrations + stake

try:
    sub = bt.Subtensor(network=CHAIN)
except Exception as e:
    print(f"[fail] Could not connect to chain: {e}", file=sys.stderr)
    sys.exit(1)

# Alice dev wallet — pre-funded with 1,000,000 TAO on any Bittensor --dev chain
alice = btw.Wallet(name="_alice_dev", hotkey="default")
alice.create_coldkey_from_uri("//Alice", use_password=False, overwrite=True, suppress=True)
alice.create_hotkey_from_uri("//Alice", use_password=False, overwrite=True, suppress=True)
print(f"[setup] Alice address: {alice.coldkeypub.ss58_address}")

for name in ["owner", "validator", "miner1", "miner2", "miner3"]:
    try:
        w = btw.Wallet(name=name, hotkey="default")
        dest = w.coldkeypub.ss58_address
        resp = sub.transfer(
            wallet=alice,
            destination_ss58=dest,
            amount=bt.Balance.from_tao(AMOUNT),
            wait_for_inclusion=True,
            wait_for_finalization=False,
        )
        if resp and (resp.is_success if hasattr(resp, 'is_success') else True):
            print(f"[setup]   Funded {name} ({dest[:12]}…) — {AMOUNT} TAO")
        else:
            print(f"[warn]    Transfer to {name} returned: {resp}", file=sys.stderr)
    except Exception as e:
        print(f"[warn]    Could not fund {name}: {e}", file=sys.stderr)

PYEOF

ok "All wallets funded."

# ── 4-6. Register neurons + stake (Python SDK — no btcli prompts) ────────────
# The subtensor-localnet image ships with subnet 1 pre-existing (owned by Alice).
# We skip subnet creation and go straight to registering our four neurons.
# burned_register() deducts the registration fee from each wallet's coldkey.
# add_stake() gives the validator a permit so miners accept its dendrite queries.
log "Registering neurons and staking validator on netuid=${NETUID}…"

python - <<'PYEOF'
import bittensor as bt
import bittensor_wallet as btw
import sys

CHAIN  = "ws://127.0.0.1:9944"
NETUID = 1

try:
    sub = bt.Subtensor(network=CHAIN)
except Exception as e:
    print(f"[fail] Could not connect to chain: {e}", file=sys.stderr)
    sys.exit(1)

# ── Register validator + miners ─────────────────────────────────────────────
for name in ["validator", "miner1", "miner2", "miner3"]:
    w = btw.Wallet(name=name, hotkey="default")
    hk = w.hotkey.ss58_address
    # Skip if already registered
    if hk in (sub.metagraph(NETUID).hotkeys or []):
        print(f"[warn]    {name} already registered — skipping.")
        continue
    try:
        resp = sub.burned_register(
            wallet=w,
            netuid=NETUID,
            wait_for_inclusion=True,
            wait_for_finalization=False,
        )
        ok = resp.is_success if hasattr(resp, "is_success") else bool(resp)
        if ok:
            print(f"[setup]   Registered {name} on netuid {NETUID}")
        else:
            print(f"[warn]    {name} registration returned: {resp}", file=sys.stderr)
    except Exception as e:
        print(f"[warn]    Could not register {name}: {e}", file=sys.stderr)

# ── Stake validator ──────────────────────────────────────────────────────────
val   = btw.Wallet(name="validator", hotkey="default")
try:
    resp = sub.add_stake(
        wallet=val,
        netuid=NETUID,
        hotkey_ss58=val.hotkey.ss58_address,
        amount=bt.Balance.from_tao(1000),
        wait_for_inclusion=True,
        wait_for_finalization=False,
    )
    ok = resp.is_success if hasattr(resp, "is_success") else bool(resp)
    print("[setup]   Validator staked (1000 TAO)" if ok
          else f"[warn]    Stake returned: {resp}")
except Exception as e:
    print(f"[warn]    Could not stake validator: {e}", file=sys.stderr)

PYEOF

ok "Neurons registered and validator staked."

# ── 7. Sanity check ──────────────────────────────────────────────────────────
log "Metagraph snapshot (netuid=${NETUID}):"
python - <<'PYEOF'
import bittensor as bt, bittensor_wallet as btw
sub = bt.Subtensor(network="ws://127.0.0.1:9944")
mg  = sub.metagraph(1)
print(f"  Neurons on subnet 1: {mg.n.item()}")
for name in ["validator", "miner1", "miner2", "miner3"]:
    w  = btw.Wallet(name=name, hotkey="default")
    hk = w.hotkey.ss58_address
    registered = hk in (mg.hotkeys or [])
    print(f"  {name}: {'✓ registered' if registered else '✗ NOT registered'}")
PYEOF

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║        Local subtensor setup complete!                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Chain endpoint  :  ws://127.0.0.1:9944                 ║"
echo "║  Subnet netuid   :  1                                   ║"
echo "║  Wallets         :  owner / validator / miner1-3        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Next step:                                             ║"
echo "║    bash scripts/run_demo.sh                             ║"
echo "╚══════════════════════════════════════════════════════════╝"
