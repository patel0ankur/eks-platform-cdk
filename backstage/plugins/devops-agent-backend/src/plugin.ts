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
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';
import { DevOpsAgentService } from './service/types';
import { MockDevOpsAgentService } from './service/MockDevOpsAgentService';
import { AwsDevOpsAgentService } from './service/AwsDevOpsAgentService';
import { SpaceWebhookConfig, WebhookClient } from './service/WebhookClient';

/**
 * AWS DevOps Agent backend plugin.
 *
 * Serves the routes the frontend plugin calls. With `devOpsAgent.mock: true` it
 * returns deterministic mock data (no AWS needed); otherwise it calls the AWS
 * DevOps Agent API using the default AWS credential provider chain.
 *
 * @public
 */
export const devopsAgentPlugin = createBackendPlugin({
  pluginId: 'devops-agent',
  register(env) {
    env.registerInit({
      deps: {
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ httpAuth, httpRouter, logger, config }) {
        const root = config.getOptionalConfig('devOpsAgent');
        const mock = root?.getOptionalBoolean('mock') ?? false;

        let devOpsAgent: DevOpsAgentService;
        if (mock) {
          logger.info(
            'AWS DevOps Agent plugin running in MOCK mode (devOpsAgent.mock=true)',
          );
          devOpsAgent = new MockDevOpsAgentService();
        } else {
          // Collect per-space webhook config (optional; needed for "Start
          // investigation").
          const webhooks: Record<string, SpaceWebhookConfig> = {};
          const spaces = root?.getOptionalConfig('spaces');
          for (const spaceId of spaces?.keys() ?? []) {
            const wh = spaces?.getOptionalConfig(`${spaceId}.webhook`);
            if (wh) {
              webhooks[spaceId] = {
                url: wh.getString('url'),
                secret: wh.getString('secret'),
              };
            }
          }

          devOpsAgent = new AwsDevOpsAgentService({
            logger,
            region: root?.getOptionalString('region'),
            assumeRoleArn: root?.getOptionalString('assumeRoleArn'),
            userType: root?.getOptionalString('userType') as
              | 'IAM'
              | 'IDC'
              | 'IDP'
              | undefined,
            webhooks: Object.keys(webhooks).length
              ? new WebhookClient({ logger, webhooks })
              : undefined,
          });
        }

        httpRouter.use(await createRouter({ httpAuth, devOpsAgent }));
      },
    });
  },
});