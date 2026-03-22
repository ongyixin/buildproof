#!/usr/bin/env bash
# Kill all demo processes launched by run_demo.sh.
LOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/logs"

echo "[stop_demo] Stopping BuildProof demo processes…"
for pidfile in "${LOG_DIR}"/*.pid; do
  [[ -f "${pidfile}" ]] || continue
  pid=$(cat "${pidfile}" 2>/dev/null) || continue
  label=$(basename "${pidfile}" .pid)
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" && echo "  Killed ${label} (PID ${pid})"
  else
    echo "  ${label} (PID ${pid}) was not running."
  fi
  rm -f "${pidfile}"
done
echo "[stop_demo] Done."
