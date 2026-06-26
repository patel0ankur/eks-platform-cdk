/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ApiBlueprint,
  createApiRef,
  createFrontendModule,
  discoveryApiRef,
  configApiRef,
  oauthRequestApiRef,
} from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import {
  OpenIdConnectApi,
  ProfileInfoApi,
  BackstageIdentityApi,
  SessionApi,
} from '@backstage/core-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';
import { SignInPage } from '@backstage/core-components';

/**
 * Keycloak sign-in for the new frontend system. Backstage has no built-in auth
 * API ref for the generic OIDC provider, so we create one and back it with
 * OAuth2 pointed at the "oidc" provider (the id MUST be "oidc" to match the
 * backend's generic OIDC strategy and the /api/auth/oidc/... callback).
 */
export const keycloakAuthApiRef = createApiRef<
  OpenIdConnectApi & ProfileInfoApi & BackstageIdentityApi & SessionApi
>({
  id: 'auth.keycloak',
});

const keycloakAuthApi = ApiBlueprint.make({
  name: 'keycloak-auth',
  params: defineParams =>
    defineParams({
      api: keycloakAuthApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        oauthRequestApi: oauthRequestApiRef,
        configApi: configApiRef,
      },
      factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
        OAuth2.create({
          configApi,
          discoveryApi,
          oauthRequestApi,
          provider: {
            id: 'oidc',
            title: 'Keycloak',
            icon: () => null,
          },
          environment: configApi.getOptionalString('auth.environment'),
          defaultScopes: ['openid', 'profile', 'email'],
        }),
    }),
});

const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => props =>
      (
        <SignInPage
          {...props}
          // Offer both: "guest" works for local development; "Keycloak" is the
          // real SSO used on the cluster. Whichever the environment supports is
          // the one users pick.
          providers={[
            'guest',
            {
              id: 'keycloak',
              title: 'Keycloak',
              message: 'Sign in with Keycloak',
              apiRef: keycloakAuthApiRef,
            },
          ]}
        />
      ),
  },
});

/** Frontend module that registers the Keycloak auth API + sign-in page. */
export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [keycloakAuthApi, signInPage],
});
