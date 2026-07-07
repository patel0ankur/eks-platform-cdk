import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
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
    notificationsPlugin,
    signalsPlugin,
    authModule,
    navModule,
  ],
});
