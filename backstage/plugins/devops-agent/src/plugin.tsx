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
  createFrontendPlugin,
  ApiBlueprint,
  discoveryApiRef,
  fetchApiRef,
  type FrontendPlugin,
} from '@backstage/frontend-plugin-api';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { devOpsAgentApiRef, DevOpsAgentClient } from './api';
import { isDevOpsAgentAvailable } from './annotations';

/** Registers the DevOpsAgentApi (frontend client to our backend plugin). */
const devOpsAgentApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: devOpsAgentApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new DevOpsAgentClient({ discoveryApi, fetchApi }),
    }),
});

/**
 * The "DevOps Agent" tab on a component's entity page. Gated by
 * isDevOpsAgentAvailable so the tab only appears for components that declare the
 * aws-devops-agent/space-id annotation (same model as the Kubernetes/ArgoCD
 * tabs). Grouped under "deployment" alongside those tabs.
 */
const entityContent = EntityContentBlueprint.make({
  name: 'devops-agent',
  params: {
    path: '/devops-agent',
    title: 'DevOps Agent',
    group: 'deployment',
    filter: isDevOpsAgentAvailable,
    loader: () =>
      import('./components/DevOpsAgentContent').then(m => (
        <m.DevOpsAgentContent />
      )),
  },
});

export const devopsAgentPlugin: FrontendPlugin = createFrontendPlugin({
  pluginId: 'devops-agent',
  extensions: [devOpsAgentApi, entityContent],
});