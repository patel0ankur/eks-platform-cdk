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
import { mockServices } from '@backstage/backend-test-utils';
import { WebhookClient } from './WebhookClient';

describe('WebhookClient', () => {
  it('signs the incident payload with HMAC-SHA256 over `${timestamp}:${body}`', async () => {
    let captured: { url: string; init: any } | undefined;
    const fakeFetch = (async (url: any, init: any) => {
      captured = { url, init };
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    const client = new WebhookClient({
      logger: mockServices.logger.mock(),
      webhooks: {
        'space-1': { url: 'https://example.test/webhook', secret: 's3cr3t' },
      },
      fetchImpl: fakeFetch,
    });

    const result = await client.triggerInvestigation('space-1', {
      title: 'Test',
      priority: 'HIGH',
    });

    expect(result.accepted).toBe(true);
    expect(captured?.url).toBe('https://example.test/webhook');

    const ts = captured!.init.headers['x-amzn-event-timestamp'];
    const sig = captured!.init.headers['x-amzn-event-signature'];
    const body = captured!.init.body as string;

    // Recompute the signature the way AWS DevOps Agent verifies it.
    const expected = createHmac('sha256', 's3cr3t')
      .update(`${ts}:${body}`, 'utf8')
      .digest('base64');
    expect(sig).toEqual(expected);

    const parsed = JSON.parse(body);
    expect(parsed.eventType).toBe('incident');
    expect(parsed.priority).toBe('HIGH');
    expect(parsed.title).toBe('Test');
  });

  it('throws for a space with no configured webhook', async () => {
    const client = new WebhookClient({
      logger: mockServices.logger.mock(),
      webhooks: {},
    });
    await expect(
      client.triggerInvestigation('unknown', { title: 'x' }),
    ).rejects.toThrow(/No webhook configured/);
  });
});