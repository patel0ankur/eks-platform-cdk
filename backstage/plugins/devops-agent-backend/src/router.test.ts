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

import { mockServices } from '@backstage/backend-test-utils';
import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import express from 'express';
import request from 'supertest';
import { createRouter } from './router';
import { MockDevOpsAgentService } from './service/MockDevOpsAgentService';

/**
 * Router tests against the mock service — these exercise the full HTTP contract
 * the frontend depends on, without needing a real AWS DevOps Agent Space.
 */
describe('createRouter (mock service)', () => {
  let app: express.Express;

  beforeAll(async () => {
    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      devOpsAgent: new MockDevOpsAgentService(),
    });
    // Mirror production error handling so InputError maps to HTTP 400 (the real
    // backend installs this middleware around every plugin router).
    const middleware = MiddlewareFactory.create({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
    });
    app = express()
      .use(router)
      .use(middleware.error());
  });

  it('lists recommendations for a space', async () => {
    const res = await request(app).get('/spaces/space-123/recommendations');
    expect(res.status).toEqual(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(res.body.recommendations[0]).toMatchObject({
      title: expect.any(String),
      priority: expect.stringMatching(/HIGH|MEDIUM|LOW/),
      status: expect.any(String),
    });
  });

  it('lists investigations for a space', async () => {
    const res = await request(app).get('/spaces/space-123/investigations');
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body.investigations)).toBe(true);
  });

  it('starts a chat and sends a message', async () => {
    const start = await request(app).post('/spaces/space-123/chat');
    expect(start.status).toEqual(200);
    expect(start.body.executionId).toBeDefined();

    const msg = await request(app)
      .post(`/spaces/space-123/chat/${start.body.executionId}/messages`)
      .send({ content: 'why is latency high?' });
    expect(msg.status).toEqual(200);
    expect(msg.body.content).toContain('why is latency high?');
  });

  it('rejects an empty chat message', async () => {
    const start = await request(app).post('/spaces/space-123/chat');
    const msg = await request(app)
      .post(`/spaces/space-123/chat/${start.body.executionId}/messages`)
      .send({ content: '' });
    expect(msg.status).toEqual(400);
  });

  it('starts an investigation', async () => {
    const res = await request(app)
      .post('/spaces/space-123/investigations')
      .send({ title: 'Manual check', priority: 'MEDIUM' });
    expect(res.status).toEqual(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.incidentId).toBeDefined();
  });

  it('rejects an investigation with no title', async () => {
    const res = await request(app)
      .post('/spaces/space-123/investigations')
      .send({ priority: 'LOW' });
    expect(res.status).toEqual(400);
  });
});