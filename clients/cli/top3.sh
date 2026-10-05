#!/usr/bin/env bash
# Lightweight top-3 priorities fetcher for shell prompts or tmux

SERVICE_URL="${TASKIFY_URL:-http://localhost:8080/api/v1}/tasks/top?limit=3"

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required for top3.sh"
  exit 1
fi

RESPONSE=$(curl -s --max-time 2 "$SERVICE_URL")

# Check if response is empty or fails to parse .tasks array
if [ -z "$RESPONSE" ] || ! echo "$RESPONSE" | jq -e '.tasks' &> /dev/null; then
  echo "[Taskify Service Offline]"
  exit 1
fi

echo "=== TODAY'S TOP PRIORITIES ==="
echo "$RESPONSE" | jq -r '.tasks[] | "  \(.id). [\(.metrics.weight | tostring | .[0:4])W] \(.title) (\(.metrics.statusText))"'
