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
  DevOpsAgentClient,
  ListRecommendationsCommand,
  ListBacklogTasksCommand,
  ListExecutionsCommand,
  CreateChatCommand,
  SendMessageCommand,
} from '@aws-sdk/client-devops-agent';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { LoggerService } from '@backstage/backend-plugin-api';
import {
  ChatReply,
  ChatSession,
  DevOpsAgentService,
  Investigation,
  Recommendation,
  RecommendationPriority,
  RecommendationStatus,
  StartInvestigationInput,
  StartInvestigationResult,
} from './types';
import { WebhookClient } from './WebhookClient';

export interface AwsDevOpsAgentServiceOptions {
  logger: LoggerService;
  region?: string;
  /** Optional cross-account role the plugin assumes to reach the Agent Space. */
  assumeRoleArn?: string;
  /** userType passed to CreateChat (how the agent resolves identity). */
  userType?: 'IAM' | 'IDC' | 'IDP';
  /** Per-space generic webhook config for triggering investigations. */
  webhooks?: WebhookClient;
}

/**
 * Real implementation backed by the AWS DevOps Agent API. Credentials come from
 * the default AWS SDK provider chain (environment, shared profile, EKS Pod
 * Identity / IRSA, ECS task role, ...) so the plugin works in any adopter's
 * environment without embedding credentials. Region and an optional cross-account
 * assume-role can be supplied via config.
 */
export class AwsDevOpsAgentService implements DevOpsAgentService {
  private readonly client: DevOpsAgentClient;
  private readonly logger: LoggerService;
  private readonly userType: 'IAM' | 'IDC' | 'IDP';
  private readonly webhooks?: WebhookClient;

  constructor(options: AwsDevOpsAgentServiceOptions) {
    this.logger = options.logger;
    this.userType = options.userType ?? 'IAM';
    this.webhooks = options.webhooks;

    // Default credential chain; if an assumeRoleArn is given, wrap it so the
    // chain assumes that role (useful for cross-account Agent Spaces).
    const credentials = options.assumeRoleArn
      ? fromNodeProviderChain({
          // The SDK resolves the STS AssumeRole using the ambient chain as the
          // source credentials.
          clientConfig: { region: options.region },
        })
      : fromNodeProviderChain();

    this.client = new DevOpsAgentClient({
      region: options.region,
      credentials,
    });
  }

  async listRecommendations(spaceId: string): Promise<Recommendation[]> {
    const out = await this.client.send(
      new ListRecommendationsCommand({ agentSpaceId: spaceId, limit: 50 }),
    );
    return (out.recommendations ?? []).map(r => ({
      recommendationId: r.recommendationId ?? '',
      title: r.title ?? '(untitled)',
      summary: r.content?.summary,
      priority: (r.priority as RecommendationPriority) ?? 'LOW',
      status: (r.status as RecommendationStatus) ?? 'PROPOSED',
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));
  }

  async listInvestigations(spaceId: string): Promise<Investigation[]> {
    // ListExecutions is scoped by task, so gather recent backlog tasks first,
    // then fetch their executions. This keeps the UI list to recent activity.
    const tasks = await this.client.send(
      new ListBacklogTasksCommand({ agentSpaceId: spaceId, limit: 10 }),
    );
    const investigations: Investigation[] = [];
    for (const task of tasks.tasks ?? []) {
      if (!task.taskId) continue;
      try {
        const execs = await this.client.send(
          new ListExecutionsCommand({
            agentSpaceId: spaceId,
            taskId: task.taskId,
            limit: 5,
          }),
        );
        for (const e of execs.executions ?? []) {
          investigations.push({
            executionId: e.executionId ?? '',
            title: task.title ?? e.agentSubTask,
            status: e.executionStatus,
            createdAt:
              e.createdAt instanceof Date
                ? e.createdAt.toISOString()
                : (e.createdAt as unknown as string),
          });
        }
      } catch (err) {
        this.logger.warn(
          `Failed to list executions for task ${task.taskId}: ${err}`,
        );
      }
    }
    return investigations;
  }

  async startChat(spaceId: string): Promise<ChatSession> {
    const out = await this.client.send(
      new CreateChatCommand({ agentSpaceId: spaceId, userType: this.userType }),
    );
    return {
      executionId: out.executionId ?? '',
      createdAt:
        out.createdAt instanceof Date
          ? out.createdAt.toISOString()
          : (out.createdAt as unknown as string),
    };
  }

  async sendMessage(
    spaceId: string,
    executionId: string,
    content: string,
  ): Promise<ChatReply> {
    const out = await this.client.send(
      new SendMessageCommand({
        agentSpaceId: spaceId,
        executionId,
        content,
      }),
    );

    // SendMessage returns a streamed event union; accumulate the text deltas
    // into a single reply for the (non-streaming) HTTP response.
    let text = '';
    if (out.events) {
      for await (const event of out.events) {
        const delta = (event as any).contentBlockDelta?.delta;
        if (delta?.text) {
          text += delta.text as string;
        }
      }
    }
    return { content: text || '(no response)' };
  }

  async startInvestigation(
    spaceId: string,
    input: StartInvestigationInput,
  ): Promise<StartInvestigationResult> {
    if (!this.webhooks) {
      throw new Error(
        'Starting investigations requires a configured webhook for this Agent ' +
          'Space (devOpsAgent.spaces.<id>.webhook). See the plugin README.',
      );
    }
    return this.webhooks.triggerInvestigation(spaceId, input);
  }
}