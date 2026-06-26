import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
// Platform plugins (new frontend system). Adding each plugin's /alpha export to
// the features array registers its extensions, including the entity-page tabs:
//   - kubernetes: "Kubernetes" tab (live workloads on the EKS cluster)
//   - argo-cd:    ArgoCD sync/health (this platform's CD mechanism)
// (CI is intentionally not surfaced as GitHub Actions: this platform builds with
//  CodeBuild and deploys with ArgoCD, so an Actions tab would be empty/misleading.)
import kubernetesPlugin from '@backstage/plugin-kubernetes/alpha';
import argoCdPlugin from '@roadiehq/backstage-plugin-argo-cd/alpha';
// All frontend plugins are registered EXPLICITLY rather than relying on
// auto-discovery (`app.packages: all`), which proved unreliable in this build —
// without these, their nav items (Create, APIs, Docs, Settings) and APIs (search,
// notifications) are missing. Explicit registration is deterministic and makes
// the app's surface obvious.
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import apiDocsPlugin from '@backstage/plugin-api-docs/alpha';
import techdocsPlugin from '@backstage/plugin-techdocs/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import catalogImportPlugin from '@backstage/plugin-catalog-import/alpha';
import catalogGraphPlugin from '@backstage/plugin-catalog-graph/alpha';
import orgPlugin from '@backstage/plugin-org/alpha';
// Notifications + signals: the sidebar uses NotificationsSidebarItem, which
// needs the notifications frontend API registered.
import notificationsPlugin from '@backstage/plugin-notifications/alpha';
import signalsPlugin from '@backstage/plugin-signals/alpha';
// Our custom plugin: adds a per-component "DevOps Agent" tab (recommendations,
// investigations, chat, start-investigation) scoped to the component's AWS
// DevOps Agent Space.
import devopsAgentPlugin from '@your-scope/backstage-plugin-aws-devops-agent';
import { navModule } from './modules/nav';
// Keycloak OIDC sign-in (new frontend system): registers the auth API + a
// SignInPage with a "Sign in with Keycloak" button.
import { authModule } from './modules/auth';

export default createApp({
  features: [
    catalogPlugin,
    scaffolderPlugin,
    apiDocsPlugin,
    techdocsPlugin,
    searchPlugin,
    userSettingsPlugin,
    catalogImportPlugin,
    catalogGraphPlugin,
    orgPlugin,
    kubernetesPlugin,
    argoCdPlugin,
    devopsAgentPlugin,
    notificationsPlugin,
    signalsPlugin,
    authModule,
    navModule,
  ],
});
