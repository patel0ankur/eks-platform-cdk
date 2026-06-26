# Backstage own-app — work-in-progress resume notes

Our OWN Backstage app (Apache-2.0), scaffolded fresh to replace the unlicensed
CNOE-derived image. This folder (`backstage-app/`) is the temp scaffold; it will
be vendored into the repo's `backstage/` build context once it's solid.

## Status: local dev working with GUEST login. Entity-page wiring DONE (step 1). Kubernetes + ArgoCD tabs render (404/no-data locally = expected, need EKS config). GitHub Actions plugin REMOVED (doesn't fit CodeBuild+ArgoCD pipeline).

## Versions (pinned)
- Backstage release: **1.52.0** (latest stable as of 2026-06-25; create-app 0.8.4)
- Node: **22.22.0** — use the Homebrew keg, NOT system node (system is v25, too new
  for Backstage). Prefix every command with:
  `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`
- Package manager: Yarn 4.13.0 (berry, bundled in `.yarn/`)

## How to run locally
```
cd backstage-app
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
yarn install      # first time only (~3 min)
yarn start        # frontend :3000, backend :7007
```
Open http://localhost:3000 → click "Enter" (guest). In-memory SQLite, no Postgres
needed locally. Backend baseUrl/db come from app-config.yaml (dev) and
app-config.production.yaml (deployed).

## What's DONE
- Fresh scaffold from official @backstage/create-app (Apache-2.0). Uses the NEW
  FRONTEND SYSTEM (`createApp({features})` in packages/app/src/App.tsx — NOT the
  legacy explicit-routes/EntityPage style CNOE used).
- Guest login verified end-to-end (token issued, catalog reads work).
- Tier-1 + GitHub plugins INSTALLED:
  - BACKEND (packages/backend/src/index.ts): added
    `@backstage/plugin-catalog-backend-module-github` (GitHub org discovery).
    kubernetes-backend, scaffolder+github, techdocs, search, catalog all already
    present from the template.
  - FRONTEND (packages/app/package.json): `@backstage/plugin-kubernetes` (^0.12.20,
    template default), `@roadiehq/backstage-plugin-argo-cd` (^2.12.5),
    `@backstage-community/plugin-github-actions` (PINNED 1.1.0 — see age-gate note).
    All three ship an `/alpha` (new-frontend-system) export.
- GitHub org auto-discovery config lives in **app-config.production.yaml** under
  `catalog.providers.github` (NOT base config) because an unset `${GITHUB_ORG}`
  CRASHES the backend at boot (BackendStartupError "Either organization or app must
  be specified"). Production-only keeps local dev booting clean.

## GOTCHAS already hit + resolved
- System node is v25 (odd, unsupported). Must use Homebrew node@22 (see above).
- Yarn `npmMinimalAgeGate: 3d` in `.yarnrc.yml` QUARANTINES packages published <3
  days ago (good supply-chain guard — KEEP it). github-actions 1.2.0 was 1 day old
  → used 1.1.0 (2026-05-27) instead. `@backstage/*` is preapproved so core pkgs
  install regardless of age.
- GitHub catalog provider crashes boot with unset org → moved to production config.

## NEXT STEPS (TODO — agreed scope: Tier 1 + GitHub discovery + Keycloak)
1. **Entity-page wiring — DONE.** New frontend system: added each plugin's /alpha
   default export to `createApp({features})` in packages/app/src/App.tsx
   (kubernetesPlugin, argoCdPlugin). That auto-registers the entity-page tabs — no
   app.extensions/EntityPage.tsx edits needed. Verified: KUBERNETES + ARGOCD tabs
   render. The K8s tab is gated by `isKubernetesAvailable` (entity must have
   annotation `backstage.io/kubernetes-id` or `backstage.io/kubernetes-label-selector`);
   added `backstage.io/kubernetes-id` + `argocd/app-name` to examples/entities.yaml
   example-website so the tabs show. Locally both tabs show a 404/no-data warning =
   EXPECTED (no kubernetes:/argocd: config yet — that's steps 2 & 3, EKS-phase).
   GitHub Actions plugin was REMOVED (platform uses CodeBuild+ArgoCD, not Actions).
2. **Kubernetes config** (`kubernetes:` block in app-config — currently empty). Needs
   the in-cluster ServiceAccount + cluster locator. This is the deferred "8e" work
   (we set automountServiceAccountToken:false on the old image). Only shows real data
   ON the EKS cluster.
3. **ArgoCD config** (`argocd:` proxy/instance config). Needs the ArgoCD API reachable
   + a token. Only real data on-cluster.
4. **Software template — DONE (renders locally; publish needs GitHub token, EKS phase).**
   templates/eks-service/ — "Containerized service on EKS". Form: name, description,
   owner (OwnerPicker), port, repoUrl (RepoUrlPicker github.com). Generates: app.js +
   package.json + Dockerfile + k8s/deployment.yaml (Service+Deployment, label
   backstage.io/kubernetes-id) + README + catalog-info.yaml (annotations
   backstage.io/kubernetes-id + argocd/app-name so the new component gets the K8s+ArgoCD
   tabs). Steps: fetch-base -> publish:github -> fetch-argocd (renders ArgoCD App with
   the published remoteUrl) -> github:repo:push (adds k8s/argocd-application.yaml) ->
   catalog:register. Registered via app-config catalog.locations + GLOBAL catalog.rules
   now include Template.
   GOTCHA SOLVED: a `file` location's per-location `rules: allow:[Template]` is NOT
   enough — Backstage wraps the file in a `generated-<sha1(fileURL)>` location that only
   honors the GLOBAL catalog.rules. Since setting catalog.rules REPLACES the defaults,
   the global rules must list [Component, System, API, Resource, Location, Template].
   Also: config/catalog changes need a FULL backend restart (stale process kept old
   rules and masked the fix). Verified: template registers (count=2, 0 warnings), all 7
   content files render through Nunjucks cleanly, catalog-info + argocd YAML valid.
   parseRepoUrl is NOT a Nunjucks filter — get the repo URL from
   steps.publish.output.remoteUrl in a 2nd fetch:template after publish.
5. **Keycloak OIDC** — swap the guest provider for Keycloak. The stock template has NO
   Keycloak; use `@backstage/plugin-auth-backend-module-oidc-provider` (Apache-2.0) +
   a sign-in resolver + custom SignInPage. REUSE the proven config:
   - metadataUrl: https://patelax.people.aws.dev/keycloak/realms/backstage/.well-known/openid-configuration
   - clientId: backstage; clientSecret from k8s secret keycloak-clients key
     BACKSTAGE_CLIENT_SECRET; redirect_uri https://patelax.people.aws.dev/api/auth/keycloak-oidc/handler/frame
   - realm "backstage" already has the client + "groups" client scope. THIS is the
     riskiest step (resolver + SignInPage on a fresh app).
6. **Vendor into repo `backstage/`** — replace the current Dockerfile (which git-clones
   CNOE + applies a patch) with one that builds THIS app from local source (no external
   clone). Then CodeBuild → ECR → EKS as before. Host at ROOT "/" (assets at /static).
   STATUS: queued (to-do). Moves us toward the EKS deploy.

7. **Custom plugin — PLANNED (user will provide details).** User wants to build a custom
   plugin; will describe what it should do. Effort landscape already discussed:
   - Local testing is easy: `yarn new` scaffolds a plugin WITH a standalone dev harness
     (`yarn workspace <plugin> start`) + auto-adds to the app; hot-reload, no cluster.
   - Cheapest + highest IDP value = a SCAFFOLDER ACTION (backend-only, no frontend-system
     tax): ~half a day for a real one (e.g. a custom template step).
   - Frontend plugins (page / entity tab) carry the NEW-FRONTEND-SYSTEM wiring tax
     (~1-2 hrs of /alpha wiring beyond what tutorials show, since most docs target the
     OLD system) → ~half–full day for something real.
   - Backend API plugin ~full day+.
   - Suggested de-risk: 1-hr hello-world first to absorb the new-frontend-system wiring.
   NEXT: wait for the user's plugin spec, then plan type + effort + local-test approach.

## Decisions locked
- Host Backstage at ROOT "/" on patelax.people.aws.dev (NOT /backstage — ALB can't
  rewrite paths; ingress-nginx retired). Keycloak stays /keycloak.
- Local = guest login; Keycloak = EKS phase only (don't add localhost redirect URIs).
- GitHub org/token = documented prereq + env placeholders (finalize in EKS phase).
- Do NOT create new domains/certs; use existing patelax.people.aws.dev + its cert.
