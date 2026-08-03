#!/usr/bin/env bash
set -u

PROMPT="$1"

MODELS=(
  "tencent/hy3:free"
  "qwen/qwen-2.5-coder-32b-instruct:free"
  "openrouter/free"
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

for MODEL in "${MODELS[@]}"; do
  echo "Attempting execution with model: $MODEL..."
  if $KCMD run --model "$MODEL" "$PROMPT"; then
    echo "Task succeeded with $MODEL"
    exit 0
  fi
  echo "Model $MODEL failed or rate-limited. Trying next fallback..."
done

echo "All model fallbacks failed."
exit 1
