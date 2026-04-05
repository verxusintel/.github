# Preview Environment Strategy

## Architecture

Previews rodam no mesmo K3s cluster dos agent-runners (Hetzner VPS isolada).
Namespace separado: `previews` (não compartilha com `arc-runners`).

```
K3s Cluster (Hetzner CX33, isolado)
├── arc-systems     → ARC controller
├── arc-runners     → Agent runner pods
└── previews        → Preview environment pods (efêmeros)
    ├── preview-pr-123-api       → API container (port dinâmica)
    ├── preview-pr-123-frontend  → Frontend serve (port dinâmica)
    └── (auto-cleanup on PR close)
```

## Isolamento
- Preview pods NÃO têm acesso a databases de prod (sem DATABASE_URL)
- Preview pods usam SQLite in-memory ou postgres efêmero no mesmo pod
- Preview pods NÃO têm secrets de prod
- NetworkPolicy restringe egress
- Pods são deletados quando PR fecha

## Preview Strategies

### Frontend (S3 no K3s — nginx pod)
1. Build vite → dist/
2. Copiar dist/ pra pod nginx temporário
3. Expor via NodePort (porta dinâmica)
4. URL: http://{VPS_TAILSCALE_IP}:{PORT}
5. Acessível via Tailscale VPN

### API (Docker no K3s)
1. Build Docker image no runner pod
2. Deploy como pod no namespace previews
3. SQLite in-memory (sem banco real)
4. Expor via NodePort
5. URL: http://{VPS_TAILSCALE_IP}:{PORT}

### Full-stack (API + Frontend)
1. Deploy API pod + Frontend pod
2. Frontend aponta pra API pod via service name
3. Expor frontend via NodePort

## Cleanup
- PR fechada → workflow deleta pods + services no namespace previews
- TTL: pods com label `ttl=4h` são limpos por cronjob se PR não fechar
