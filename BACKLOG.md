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

## Secrets: AWS Secrets Manager via Secrets Store CSI Driver — DONE (2026-06-24)

Keycloak admin + Postgres passwords now sourced from AWS Secrets Manager; NO
plaintext in git. Verified end-to-end (synced k8s Secret value matches the
SM-generated 24-char password; Keycloak connects).

What shipped:
- CDK SecretsStack (idp-secrets): generates SM secrets idp/keycloak/admin and
  idp/keycloak/postgres; a Pod Identity reader role (pods.eks.amazonaws.com,
  AssumeRole+TagSession, secretsmanager Get/Describe on idp/*) associated to the
  WORKLOAD SAs (keycloak, postgres); the EKS addon
  aws-secrets-store-csi-driver-provider with configurationValues enabling
  secrets-store-csi-driver.syncSecret.enabled + enableSecretRotation.
- GitOps gitops/platform/keycloak: ServiceAccounts (keycloak, postgres);
  SecretProviderClass per workload (usePodIdentity:"true" + secretObjects to
  sync a k8s Secret); CSI volume mount on keycloak Deployment + postgres
  StatefulSet; env from synced Secrets. Hardcoded passwords removed.

CORRECTED findings (avoid repeating mistakes):
- The aws-secrets-store-csi-driver-provider ADDON BUNDLES the core driver — do
  NOT install the core driver separately via Helm (removed that redundant app).
- syncSecret is configured via the ADDON's configurationValues, not a separate
  Helm release.
- A token-request ClusterRole (serviceaccounts/token: create) is NOT needed —
  empirically verified mount+sync work without it because the CSIDriver's
  tokenRequests (set by the addon) already includes the pods.eks.amazonaws.com
  audience. Earlier mount failures were driver reconciliation lag after enabling
  syncSecret, not missing RBAC. (Removed that ClusterRole + its app.)
- Migration gotcha (one-time, not on fresh deploy): switching Postgres password
  source from a hardcoded value to SM requires a FRESH PVC — POSTGRES_PASSWORD
  is only applied on first init of an empty data dir; a stale PVC keeps the old
  password and causes auth failures.
- Reproducibility verified: cdk diff idp-secrets = 0 drift; GitOps recreates the
  setup from git. Caveat: ArgoCD git-generator requeue (~3 min, no webhook) means
  changes to gitops/platform/* take a few minutes to reflect.

## Backstage 8a: image build — DONE (2026-06-24)

- Vendored backstage/ build context (Dockerfile + patches/cnoe-customizations.patch)
  into this repo. BackstageBuildStack (idp-backstage-build): ECR repo idp-backstage,
  CodeBuild idp-backstage-builder (LARGE, privileged) building src/backstage from
  this GitHub repo, + Lambda custom-resource auto-trigger. Image idp-backstage:latest
  in ECR (~446MB).
- BUG FIXED (the reference's, not ours): Dockerfile cloned cnoe-io/backstage-app@main
  UNPINNED and the patch had drifted vs upstream -> `patch -p1` failed. Fix: full
  clone + `git apply --3way --whitespace=nowarn`, and corrected the App.tsx hunk
  (upstream dropped `auto` from the guest SignInPage line). All 7 files apply cleanly.
- FUTURE HARDENING: pin CNOE to a specific commit in the Dockerfile so the build is
  fully reproducible (building @main is still fragile to future upstream rewrites).

## Backstage remaining: 8b ingress (ALB), 8c Keycloak realm+OIDC client, 8d deploy Backstage GitOps wired to Keycloak OIDC.

## Access / ingress — TODO (needed for Backstage)

Keycloak Service is ClusterIP only (no ingress/LB). Access today via
`kubectl port-forward -n keycloak svc/keycloak 8080:80` -> http://localhost:8080
(user admin, password in SM idp/keycloak/admin). Backstage needs Keycloak at a
stable URL for OIDC redirects, so add an ingress layer (AWS Load Balancer
Controller + Ingress, or ingress-nginx) before/with Backstage.
