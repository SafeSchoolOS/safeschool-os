#!/bin/sh
# EdgeRuntime Docker Entrypoint
#
# On first boot (no activation key), runs the setup wizard.
# After setup completes (or if already configured), starts the runtime.

set -e

ENV_FILE="${INSTALL_DIR:-/opt/edgeruntime}/.env"

# Source .env if it exists (so we can check EDGERUNTIME_ACTIVATION_KEY)
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

# If no activation key is set, run the setup wizard
if [ -z "$EDGERUNTIME_ACTIVATION_KEY" ]; then
  echo "No activation key found. Starting setup wizard..."
  echo ""
  node /app/packages/setup-wizard/dist/setup-wizard.bundle.cjs

  # Re-source .env after wizard writes it
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi

  # If still no key after wizard, something went wrong
  if [ -z "$EDGERUNTIME_ACTIVATION_KEY" ]; then
    echo "ERROR: Setup wizard exited without saving activation key."
    exit 1
  fi

  echo "Setup complete. Starting EdgeRuntime..."
fi

# Start the runtime
exec node /app/packages/runtime/dist/index.js "$@"
