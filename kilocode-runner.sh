#!/usr/bin/env bash
set -u

PROMPT="$1"

IDENTITY="You are Autonomous Kilobot — a senior-level software engineer at Google running in GitHub Actions CI. You have full autonomy to make decisions and write production-quality code. Read AGENTS.md before starting."
FULL_PROMPT="$IDENTITY

$PROMPT"

MODELS=(
  "kilo/tencent/hy3:free"
  "kilo/inclusionai/ling-3.0-flash:free"
  "kilo/cohere/north-mini-code:free"
  "kilo/kilo-auto/free"
)

# Ensure npm's global bin directory is on PATH so the globally installed
# `kilocode` binary is resolvable in this fresh shell.
NPM_GLOBAL_BIN="$(npm config get prefix 2>/dev/null)/bin"
if [ -n "${NPM_GLOBAL_BIN:-}" ]; then
  export PATH="$NPM_GLOBAL_BIN:$PATH"
fi

# Resolve the kilocode binary (fall back to `kilo` or `npx`).
KCMD=""
if command -v kilocode >/dev/null 2>&1; then
  KCMD="kilocode"
elif command -v kilo >/dev/null 2>&1; then
  KCMD="kilo"
else
  KCMD="npx -y kilocode"
fi

# Bound each model attempt so a hung/rate-limited request cannot stall the
# pipeline for hours. Override via KILO_ATTEMPT_TIMEOUT.
ATTEMPT_TIMEOUT="${KILO_ATTEMPT_TIMEOUT:-600}"

for MODEL in "${MODELS[@]}"; do
  echo "Attempting execution with model: $MODEL... (timeout ${ATTEMPT_TIMEOUT}s)"
  timeout -k 10 "$ATTEMPT_TIMEOUT" $KCMD run --auto --model "$MODEL" "$FULL_PROMPT"
  RC=$?
  if [ "$RC" -eq 0 ]; then
    echo "Task succeeded with $MODEL"
    exit 0
  fi
  echo "Model $MODEL failed, rate-limited, or timed out ($RC). Trying next fallback..."
done

echo "All model fallbacks failed."
exit 1
