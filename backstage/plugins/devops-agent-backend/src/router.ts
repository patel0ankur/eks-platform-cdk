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

import { HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import { z } from 'zod/v3';
import express from 'express';
import Router from 'express-promise-router';
import { DevOpsAgentService } from './service/types';

/**
 * HTTP routes consumed by the frontend plugin. Every route is scoped to an
 * Agent Space id taken from the path (which the frontend derives from the
 * component's annotation). All calls require an authenticated user.
 */
export async function createRouter({
  httpAuth,
  devOpsAgent,
}: {
  httpAuth: HttpAuthService;
  devOpsAgent: DevOpsAgentService;
}): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  const requireUser = (req: express.Request) =>
    httpAuth.credentials(req, { allow: ['user'] });

  const chatSchema = z.object({ content: z.string().min(1) });
  const investigationSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  });

  router.get('/spaces/:spaceId/recommendations', async (req, res) => {
    await requireUser(req);
    const recommendations = await devOpsAgent.listRecommendations(
      req.params.spaceId,
    );
    res.json({ recommendations });
  });

  router.get('/spaces/:spaceId/investigations', async (req, res) => {
    await requireUser(req);
    const investigations = await devOpsAgent.listInvestigations(
      req.params.spaceId,
    );
    res.json({ investigations });
  });

  router.post('/spaces/:spaceId/chat', async (req, res) => {
    await requireUser(req);
    res.json(await devOpsAgent.startChat(req.params.spaceId));
  });

  router.post(
    '/spaces/:spaceId/chat/:executionId/messages',
    async (req, res) => {
      await requireUser(req);
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) throw new InputError(parsed.error.toString());
      res.json(
        await devOpsAgent.sendMessage(
          req.params.spaceId,
          req.params.executionId,
          parsed.data.content,
        ),
      );
    },
  );

  router.post('/spaces/:spaceId/investigations', async (req, res) => {
    await requireUser(req);
    const parsed = investigationSchema.safeParse(req.body);
    if (!parsed.success) throw new InputError(parsed.error.toString());
    res.json(
      await devOpsAgent.startInvestigation(req.params.spaceId, parsed.data),
    );
  });

  return router;
}