#!/bin/bash
# SafeSchoolOS ISO Builder
# Delegates to the unified ISO builder with product=safeschool.
#
# Usage: ./build-iso.sh [--base-iso <path>] [--output <path>]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec "$REPO_ROOT/deploy/shared/build-iso.sh" --product safeschool "$@"
