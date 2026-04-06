#!/bin/bash
# Usage: ./linear-sync.sh <text-containing-VER-xxx> <state: todo|in_progress|in_review|done|backlog|canceled>
# Extracts VER-xxx from input text and updates the Linear issue status.
# Requires LINEAR_API_KEY environment variable.

set -euo pipefail

TEXT="${1:-}"
STATE="${2:-}"

if [ -z "$TEXT" ] || [ -z "$STATE" ]; then
  echo "Usage: $0 <text> <state>"
  echo "States: backlog, todo, in_progress, in_review, done, canceled"
  exit 1
fi

if [ -z "${LINEAR_API_KEY:-}" ]; then
  echo "LINEAR_API_KEY not set, skipping Linear sync"
  exit 0
fi

# State ID mapping (from .github/config/linear.json)
declare -A STATE_IDS=(
  ["backlog"]="9966a83f-7172-47c1-8531-7f483d0fb8d8"
  ["todo"]="38fb7897-2a2b-4246-8915-0e73be64268c"
  ["in_progress"]="d2eac226-eb3a-4572-8587-a895e4930a6b"
  ["in_review"]="271d8187-a0e4-497b-bf55-b69a1b94afe7"
  ["done"]="526fabd3-2ec0-4baf-8a54-676ae21eafcd"
  ["canceled"]="34bdbdac-ff05-4f13-a2c9-181a7f530e70"
)

STATE_ID="${STATE_IDS[$STATE]:-}"
if [ -z "$STATE_ID" ]; then
  echo "Unknown state: $STATE"
  exit 1
fi

# Extract VER-xxx identifier from input text
VER_ID=$(echo "$TEXT" | grep -oP 'VER-\d+' | head -1 || true)

if [ -z "$VER_ID" ]; then
  echo "No VER-xxx identifier found in input text, skipping"
  exit 0
fi

echo "Syncing Linear issue $VER_ID → $STATE"

# Resolve the internal Linear issue ID from the human-readable identifier
RESPONSE=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"{ issue(id: \\\"$VER_ID\\\") { id } }\"}")

INTERNAL_ID=$(echo "$RESPONSE" | jq -r '.data.issue.id // empty')

if [ -z "$INTERNAL_ID" ]; then
  echo "Could not resolve Linear issue $VER_ID (may not exist)"
  exit 0
fi

# Update the issue state
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { issueUpdate(id: \\\"$INTERNAL_ID\\\", input: { stateId: \\\"$STATE_ID\\\" }) { success } }\"}" > /dev/null

echo "Linear $VER_ID → $STATE (done)"
