# Backlog — deferred work

Items intentionally postponed, to revisit later.

## 1. Make the default CodeBuild build succeed end-to-end
- **Status:** deferred
- **Context:** `idp-lambda` auto-triggers a CodeBuild build on deploy. The
  automation chain works (Lambda → StartBuild → CodeBuild → ECR login + clone),
  but the default `SOURCE_REPO_URL` (`retail-store-sample-app`) is a multi-service
  monorepo with no root `Dockerfile`, so `docker build .` fails.
- **Options:**
  1. Leave as-is — users point it at their own repo.
  2. Change the default to a known-good single-`Dockerfile` sample so a fresh
     `cdk deploy --all` produces a real image.
  3. Add `BUILD_CONTEXT` / `DOCKERFILE_PATH` env vars to the buildspec to support
     subdirectory builds.
- **Recommendation:** option 2 for a public repo (first deploy should succeed).

## Decided directions (not deferred — recorded so they aren't re-litigated)

- **ArgoCD = EKS Capability (`AWS::EKS::Capability` type=ARGOCD), WITH Identity
  Center.** Not Helm. The ArgoCD capability requires an IDC instance ARN +
  group IDs for RBAC, so we create IDC as part of this. Do not propose Helm for
  ArgoCD again.
- **Keycloak = standalone IdP** (needed for Backstage), does NOT depend on IDC.
  Future component.
- **Backstage** = developer portal, authenticates via Keycloak. Future component.

## Backstage + Keycloak — agreed automated plan (end-user: one `cdk deploy`)

Sequence: **Keycloak (IdP) first, then Backstage**, both deployed via **ArgoCD
GitOps** (ArgoCD = the EKS capability we already deployed).

Phase 1 — Keycloak:
- ArgoCD Application CR -> `gitops/keycloak/` in this repo -> ArgoCD syncs.
- Realm + OIDC client auto-configured (realm-import), no manual console steps.

Phase 2 — Backstage:
- Build image from `backstage/` (Dockerfile + patches/cnoe-customizations.patch,
  from appmod-blueprints) shipped as a CDK asset -> dedicated CodeBuild
  `idp-backstage-builder` (privileged, ~15min multi-stage) -> ECR
  `idp-backstage:latest`. Lambda custom resource auto-triggers the build on deploy
  (same pattern as idp-lambda).
- ArgoCD Application CR -> `gitops/backstage/` -> ArgoCD syncs; Deployment pulls
  the ECR image (retries pull until the async build finishes). OIDC -> Keycloak.

RESOLVED (verified on live cluster 2026-06-24):
- The capability-managed ArgoCD installs the standard ArgoCD CRDs in-cluster
  (applications/applicationsets/appprojects.argoproj.io) and watches in-cluster
  `Application` CRs like self-hosted ArgoCD. A server-side dry-run apply of an
  Application CR succeeded; a `default` AppProject already exists.
- => GitOps wiring: CDK applies an `Application` CR via the cluster's kubectl
  layer (cluster.addManifest) pointing at gitops/<app>/ in this repo. ArgoCD
  syncs it. No ArgoCD API/CLI/IDC-auth detour needed.

Cluster registration (CORRECTED 2026-06-24 — earlier assumption was WRONG):
- The capability does NOT auto-register the local cluster. Apps fail with
  "no clusters with this name: in-cluster" until registered. kubernetes.default.svc
  is explicitly "disabled"; the ARN works only once a cluster Secret exists.
- Registering the local cluster requires TWO declarative things (both CDK-able,
  no interactive CLI / IDC token):
  1. ArgoCD cluster Secret in ns argocd, label
     argocd.argoproj.io/secret-type=cluster, stringData {name: in-cluster,
     server: <EKS CLUSTER ARN>, project: default}. MUST use the ARN, not the
     k8s API URL.
  2. K8s RBAC for the ArgoCD capability role (access entry auto-created but has
     NO rbac by default). Quick start: associate AmazonEKSClusterAdminPolicy to
     the capability role principal (aws eks associate-access-policy
     --access-scope type=cluster), or least-privilege ClusterRole(read-all) +
     per-namespace Role bound to group
     "eks-access-entry:<capabilityRoleArn>".
- => Implement in ArgoCdStack: add the cluster Secret (KubernetesManifest) +
  grantAccess(capabilityRole, AmazonEKSClusterAdminPolicy) so the ApplicationSet
  destination name=in-cluster resolves. Then Keycloak/Backstage sync.
- Docs: eks/latest/userguide/argocd-register-clusters.html
