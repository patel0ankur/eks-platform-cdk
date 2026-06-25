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

## Backstage remaining: ✅ 8b ingress (ALB), ✅ 8c Keycloak realm+OIDC client, ✅ 8d deploy Backstage GitOps wired to Keycloak OIDC. (8e real cluster integration deferred — see below.)

## 8d deploy Backstage (GitOps + Keycloak SSO) — DONE, LOGIN CONFIRMED (2026-06-25)
End-to-end verified + user logged in: Backstage at https://patelax.people.aws.dev/
(ROOT of shared domain), Keycloak at /keycloak on the same ALB. Sign in with
Keycloak SSO works (test user developer/developer in realm backstage).

What shipped:
- Manifests in `gitops/platform-apps/backstage/` (deliberately NOT under
  gitops/platform/* so the directory-ApplicationSet generator doesn't apply the
  raw image placeholder): namespace, secret-provider (SAs + SPC for the DB
  password), postgres (StatefulSet, SM password via CSI), backstage (Deployment +
  Service + app-config.extra ConfigMap), ingress, kustomization.
- Deployed as ONE CDK-applied ArgoCD Application (lib/backstage-deploy-stack.ts,
  idp-backstage-deploy): renders the dir with Kustomize and injects the ECR image
  URI via spec.source.kustomize.images ["backstage-image=<ecr>:latest"] — keeps
  the account-specific registry OUT of git.
- SecretsStack: added SM secret idp/backstage/postgres + Pod Identity assoc for
  backstage/postgres SA (existing reader role covers idp/*; existing keycloak
  assoc construct ids kept stable so nothing got replaced).
- keycloak-config Job now: publishes keycloak-clients into the BACKSTAGE namespace
  (ClusterRole; get-or-create the ns); PUTs the client so re-runs converge
  redirect_uri; creates the "groups" client scope + assigns it to the backstage
  client (fixes OIDC invalid_scope).

HOSTING DECISION (corrected): Backstage is served at the ROOT "/" of the shared
domain, NOT under /backstage. Backstage cannot run under a sub-path on ALB. The
reference repo uses /backstage only because it runs ingress-nginx with
rewrite-target to strip the prefix; we use AWS LBC (no path rewrite) and
ingress-nginx is RETIRED. So: Keycloak keeps /keycloak (supports a path prefix
natively), Backstage owns "/". Same single domain + same existing cert — NO new
subdomain/cert (account doesn't allow creating them).

Gotchas hit + fixed (CNOE backstage-app image):
- OIDC provider gated on env KEYCLOAK_URL; the baked metadataUrl points at
  cnoe.localtest.me (HARDCODED) — overridden via a layered 3rd --config file.
- MOCK_MODE=true CRASHES the prod image (mock plugins read fixture JSONs absent
  from the build) -> run real mode + automountServiceAccountToken:false so the
  backend skips k8s/kro/argocd and boots clean.
- BLANK SCREEN: image built with app.baseUrl=.../backstage bakes asset URLs to
  /backstage/static/*, but app-backend hardcodes static mount at ROOT /static ->
  assets 404 to SPA HTML -> JS won't execute. FIX: REBUILT image with root
  app.baseUrl (removed the /backstage baseUrl hunks from the patch) so assets
  bake to /static; host at root.
- SHARED-ALB RULE ORDER: with Backstage "/" + Keycloak /keycloak on one ALB group,
  set alb group.order keycloak=10 (first), backstage=100 (last) — else "/" (prio 1)
  captures /keycloak/* and OIDC discovery returns Backstage HTML -> auth 500.
- openid-client discovery is sticky -> rollout restart backstage after fixing routing.
- OIDC invalid_scope (groups): fresh realm has no "groups" client scope -> Job
  creates it + assigns to client (see above).
- ConfigMap change doesn't restart the pod -> rollout restart; new ALB rule ~45s.

## 8e (deferred): Backstage real cluster integration
Mount the SA token + provide real config for the kubernetes/kro/argocd/terraform
backends (currently skipped), TechDocs storage, catalog seeding, scaffolder
templates. The portal is up now with working Keycloak SSO; this enables the
self-service/scaffolding features.

## Access / ingress — TODO (needed for Backstage)

Keycloak Service is ClusterIP only (no ingress/LB). Access today via
`kubectl port-forward -n keycloak svc/keycloak 8080:80` -> http://localhost:8080
(user admin, password in SM idp/keycloak/admin). Backstage needs Keycloak at a
stable URL for OIDC redirects, so add an ingress layer (AWS Load Balancer
Controller + Ingress, or ingress-nginx) before/with Backstage.

## 8b ingress (AWS Load Balancer Controller) — DONE (2026-06-24)
- Single CDK-applied ArgoCD Application (IngressStack), NOT via directory ApplicationSet.
  Helm-based platform infra pattern: one CDK-applied Application, no directory-app wrapper.
- IAM: official LBC iam_policy.json (lib/policies/) via Pod Identity (kube-system/
  aws-load-balancer-controller SA). Helm values clusterName+region+vpcId explicit (portable).
- ROOT-CAUSE FIX: EKS node IMDS hop limit default=1 blocks pods from metadata (broke LBC + EBS CSI).
  Added launch template hopLimit=2. NOTE: LT only attaches at nodegroup CREATION → had to replace
  the nodegroup (renamed construct id + nodegroupName idp-nodes-lt).
- ingress-nginx is RETIRED (archived Mar 2026) — chose LBC/ALB instead.

## 8c Keycloak realm + OIDC + HTTPS — DONE (2026-06-24)
- Realm "backstage" + OIDC client "backstage" + "developer" user via PostSync config Job
  (gitops/platform/keycloak/keycloak-config.yaml) that harvests the client secret into
  k8s Secret keycloak-clients. No secrets in git.
- Keycloak served under /keycloak (KC_HTTP_RELATIVE_PATH). Reachable HTTPS at
  https://patelax.people.aws.dev/keycloak (admin console /keycloak/admin/).
- Ingress: shared ALB group "idp", HTTP+HTTPS, ssl-redirect, cert auto-discovered from
  host rule (no hardcoded ARN — that trips Code Defender push scanner). Route53 apex
  alias + ACM cert (DNS-validated) set up out-of-band.
- LESSON: KC_HTTP_RELATIVE_PATH ripples to probes, ALB healthcheck, config-Job URLs,
  KC_HOSTNAME — change all together. PostSync hook job hanging blocks the whole sync.

## TLS/DNS for public users (PREREQ to document in README)
- Provide a domain (CDK_PLATFORM_DOMAIN), an ACM cert covering it, a Route53 (or other)
  record pointing the domain at the ALB. Update the `host:` in keycloak/backstage Ingress.
