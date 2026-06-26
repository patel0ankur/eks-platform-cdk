# ${{ values.name }}

${{ values.description }}

A containerized service scaffolded for this platform's EKS cluster.

## Layout

- `app.js` / `package.json` — the application (a minimal HTTP server; replace
  with your real code).
- `Dockerfile` — builds the container image (the platform's CI builds this and
  pushes it to ECR).
- `k8s/deployment.yaml` — Kubernetes Deployment + Service.
- `k8s/argocd-application.yaml` — ArgoCD Application that deploys `k8s/` to the
  cluster (GitOps).

## Deploy

This service follows the platform's GitOps flow:

1. CI builds the image from the `Dockerfile` and pushes it to ECR.
2. Apply `k8s/argocd-application.yaml` to the platform's ArgoCD once. ArgoCD then
   watches `k8s/` and keeps the service in sync automatically.

## Local run

```sh
npm start   # serves on :${{ values.port }}
```
