#!/bin/bash
# Deploy Slack bot to K3s on the agent-runners VPS
# Usage: ./deploy.sh <SLACK_SIGNING_SECRET> <SLACK_BOT_TOKEN> <ANTHROPIC_API_KEY> <GITHUB_TOKEN> [LINEAR_API_KEY]
set -euo pipefail

SLACK_SIGNING_SECRET="${1:?Usage: ./deploy.sh <SLACK_SIGNING_SECRET> <SLACK_BOT_TOKEN> <ANTHROPIC_API_KEY> <GITHUB_TOKEN> [LINEAR_API_KEY]}"
SLACK_BOT_TOKEN="${2:?}"
ANTHROPIC_API_KEY="${3:?}"
GITHUB_TOKEN="${4:?}"
LINEAR_API_KEY="${5:-}"

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

echo "=== Building Docker image ==="
cd "$(dirname "$0")"
docker build -t slack-bot:latest .

echo "=== Importing image to K3s ==="
docker save slack-bot:latest | ctr --address /run/k3s/containerd/containerd.sock --namespace k8s.io images import -

echo "=== Creating namespace + secrets ==="
kubectl create namespace slack-bot 2>/dev/null || true

kubectl create secret generic slack-bot-secrets \
  --namespace slack-bot \
  --from-literal=SLACK_SIGNING_SECRET="$SLACK_SIGNING_SECRET" \
  --from-literal=SLACK_BOT_TOKEN="$SLACK_BOT_TOKEN" \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  --from-literal=GITHUB_TOKEN="$GITHUB_TOKEN" \
  --from-literal=LINEAR_API_KEY="$LINEAR_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "=== Deploying ==="
kubectl apply -f k8s.yaml

echo "=== Waiting for pod ==="
kubectl wait --for=condition=Ready pod -l app=slack-bot -n slack-bot --timeout=120s

echo "=== Status ==="
kubectl get pods -n slack-bot -o wide
kubectl get svc -n slack-bot

VPS_IP=$(curl -sf http://169.254.169.254/2009-04-04/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')
TS_IP=$(tailscale ip -4 2>/dev/null || echo "N/A")

echo ""
echo "========================================"
echo "Slack bot deployed!"
echo "========================================"
echo ""
echo "Endpoints:"
echo "  Public:    http://${VPS_IP}:30333"
echo "  Tailscale: http://${TS_IP}:30333"
echo "  Health:    http://${VPS_IP}:30333/health"
echo ""
echo "Set this as Slack Event Subscription URL:"
echo "  http://${VPS_IP}:30333"
echo ""
echo "Note: For HTTPS, put a reverse proxy (nginx/caddy) in front."
