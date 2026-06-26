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
  createApiRef,
  DiscoveryApi,
  FetchApi,
} from '@backstage/frontend-plugin-api';
import {
  ChatReply,
  ChatSession,
  Investigation,
  Recommendation,
  StartInvestigationResult,
} from './types';

/**
 * Client interface the DevOps Agent UI uses. All calls go to OUR backend plugin
 * (which holds AWS credentials and talks to the AWS DevOps Agent API) — the
 * browser never sees AWS credentials.
 */
export interface DevOpsAgentApi {
  listRecommendations(spaceId: string): Promise<Recommendation[]>;
  listInvestigations(spaceId: string): Promise<Investigation[]>;
  startChat(spaceId: string): Promise<ChatSession>;
  sendMessage(
    spaceId: string,
    executionId: string,
    content: string,
  ): Promise<ChatReply>;
  startInvestigation(
    spaceId: string,
    input: { title: string; description?: string; priority?: string },
  ): Promise<StartInvestigationResult>;
}

export const devOpsAgentApiRef = createApiRef<DevOpsAgentApi>({
  id: 'plugin.devops-agent.service',
});

/** Default implementation that calls the devops-agent backend plugin routes. */
export class DevOpsAgentClient implements DevOpsAgentApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  private async baseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('devops-agent');
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchApi.fetch(`${await this.baseUrl()}${path}`);
    if (!res.ok) {
      throw new Error(
        `DevOps Agent request failed (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchApi.fetch(`${await this.baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `DevOps Agent request failed (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  async listRecommendations(spaceId: string): Promise<Recommendation[]> {
    const { recommendations } = await this.getJson<{
      recommendations: Recommendation[];
    }>(`/spaces/${encodeURIComponent(spaceId)}/recommendations`);
    return recommendations;
  }

  async listInvestigations(spaceId: string): Promise<Investigation[]> {
    const { investigations } = await this.getJson<{
      investigations: Investigation[];
    }>(`/spaces/${encodeURIComponent(spaceId)}/investigations`);
    return investigations;
  }

  async startChat(spaceId: string): Promise<ChatSession> {
    return this.postJson<ChatSession>(
      `/spaces/${encodeURIComponent(spaceId)}/chat`,
      {},
    );
  }

  async sendMessage(
    spaceId: string,
    executionId: string,
    content: string,
  ): Promise<ChatReply> {
    return this.postJson<ChatReply>(
      `/spaces/${encodeURIComponent(spaceId)}/chat/${encodeURIComponent(
        executionId,
      )}/messages`,
      { content },
    );
  }

  async startInvestigation(
    spaceId: string,
    input: { title: string; description?: string; priority?: string },
  ): Promise<StartInvestigationResult> {
    return this.postJson<StartInvestigationResult>(
      `/spaces/${encodeURIComponent(spaceId)}/investigations`,
      input,
    );
  }
}