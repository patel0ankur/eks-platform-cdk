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
  ChatReply,
  ChatSession,
  DevOpsAgentService,
  Investigation,
  Recommendation,
  StartInvestigationInput,
  StartInvestigationResult,
} from './types';

/**
 * In-memory implementation used when `devOpsAgent.mock: true` (local development
 * and CI, where no real AWS DevOps Agent Space is provisioned). Returns
 * realistic, deterministic data so the UI can be exercised end to end.
 */
export class MockDevOpsAgentService implements DevOpsAgentService {
  async listRecommendations(spaceId: string): Promise<Recommendation[]> {
    return [
      {
        recommendationId: `${spaceId}-rec-1`,
        title: 'Add a readiness probe to the deployment',
        summary:
          'The service has no readiness probe, so traffic can be routed to pods before they are ready, causing intermittent 5xx during rollouts.',
        priority: 'HIGH',
        status: 'PROPOSED',
        createdAt: '2026-06-20T10:00:00Z',
      },
      {
        recommendationId: `${spaceId}-rec-2`,
        title: 'Right-size CPU requests',
        summary:
          'CPU utilization is consistently below 15% of requests over the last 14 days; lowering requests would improve bin-packing.',
        priority: 'MEDIUM',
        status: 'PROPOSED',
        createdAt: '2026-06-19T09:00:00Z',
      },
      {
        recommendationId: `${spaceId}-rec-3`,
        title: 'Enable structured logging',
        summary:
          'Logs are unstructured, which slows investigations. Emit JSON logs to improve correlation during incidents.',
        priority: 'LOW',
        status: 'ACCEPTED',
        createdAt: '2026-06-15T08:00:00Z',
      },
    ];
  }

  async listInvestigations(spaceId: string): Promise<Investigation[]> {
    return [
      {
        executionId: `${spaceId}-inv-1`,
        title: 'Elevated p99 latency on checkout path',
        status: 'COMPLETED',
        createdAt: '2026-06-22T14:30:00Z',
      },
      {
        executionId: `${spaceId}-inv-2`,
        title: 'Deployment rollback after error spike',
        status: 'IN_PROGRESS',
        createdAt: '2026-06-24T11:05:00Z',
      },
    ];
  }

  async startChat(spaceId: string): Promise<ChatSession> {
    return {
      executionId: `${spaceId}-chat-mock`,
      createdAt: '2026-06-25T00:00:00Z',
    };
  }

  async sendMessage(
    _spaceId: string,
    _executionId: string,
    content: string,
  ): Promise<ChatReply> {
    return {
      content:
        `[mock] You asked: "${content}". With a real Agent Space, the agent ` +
        `would answer using this service's topology, telemetry, and recent ` +
        `deployments. Set devOpsAgent.mock=false and configure an Agent Space ` +
        `to get live answers.`,
    };
  }

  async startInvestigation(
    spaceId: string,
    input: StartInvestigationInput,
  ): Promise<StartInvestigationResult> {
    return {
      accepted: true,
      incidentId: `${spaceId}-incident-mock`,
      message: `[mock] Would trigger an investigation: "${input.title}".`,
    };
  }
}