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

import { createHmac } from 'crypto';
import { LoggerService } from '@backstage/backend-plugin-api';
import { StartInvestigationInput, StartInvestigationResult } from './types';

/** Per-space generic-webhook config used to trigger investigations. */
export interface SpaceWebhookConfig {
  /** Generic webhook endpoint URL (https://event-ai.<region>.api.aws/webhook/generic/<id>). */
  url: string;
  /** HMAC secret generated when the generic webhook was created. */
  secret: string;
}

/**
 * Triggers AWS DevOps Agent investigations through a Space's generic webhook.
 *
 * Generic webhooks use HMAC-SHA256 authentication: the signature is computed
 * over `${timestamp}:${payload}` with the secret, and sent in the
 * x-amzn-event-signature header alongside x-amzn-event-timestamp (per the AWS
 * DevOps Agent webhook docs). The body is an `incident` event.
 */
export class WebhookClient {
  private readonly logger: LoggerService;
  private readonly bySpace: Map<string, SpaceWebhookConfig>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    logger: LoggerService;
    webhooks: Record<string, SpaceWebhookConfig>;
    fetchImpl?: typeof fetch;
  }) {
    this.logger = options.logger;
    this.bySpace = new Map(Object.entries(options.webhooks));
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  hasSpace(spaceId: string): boolean {
    return this.bySpace.has(spaceId);
  }

  async triggerInvestigation(
    spaceId: string,
    input: StartInvestigationInput,
  ): Promise<StartInvestigationResult> {
    const cfg = this.bySpace.get(spaceId);
    if (!cfg) {
      throw new Error(
        `No webhook configured for Agent Space "${spaceId}". Add ` +
          `devOpsAgent.spaces.${spaceId}.webhook.{url,secret} to app-config.`,
      );
    }

    const timestamp = new Date().toISOString();
    const incidentId = `backstage-${Date.now()}`;
    const body = JSON.stringify({
      eventType: 'incident',
      incidentId,
      action: 'created',
      priority: input.priority ?? 'MEDIUM',
      title: input.title,
      description: input.description,
      timestamp,
      service: spaceId,
      data: { metadata: { source: 'backstage-devops-agent-plugin' } },
    });

    const signature = createHmac('sha256', cfg.secret)
      .update(`${timestamp}:${body}`, 'utf8')
      .digest('base64');

    const res = await this.fetchImpl(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-event-timestamp': timestamp,
        'x-amzn-event-signature': signature,
      },
      body,
    });

    const accepted = res.ok; // 200 = authenticated + queued
    if (!accepted) {
      this.logger.warn(
        `DevOps Agent webhook for space ${spaceId} returned ${res.status}`,
      );
    }
    return {
      accepted,
      incidentId,
      message: accepted
        ? 'Investigation request queued.'
        : `Webhook returned HTTP ${res.status}.`,
    };
  }
}