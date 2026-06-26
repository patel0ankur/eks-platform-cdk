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

/**
 * Backend-side data contract. These are a trimmed, UI-friendly projection of the
 * AWS DevOps Agent API shapes — the AWS service implementation maps SDK responses
 * onto these, and the mock returns the same shapes, so the router and the
 * frontend never depend on raw SDK types.
 */

export type RecommendationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type RecommendationStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CLOSED'
  | 'COMPLETED'
  | 'UPDATE_IN_PROGRESS';

export interface Recommendation {
  recommendationId: string;
  title: string;
  summary?: string;
  priority: RecommendationPriority;
  status: RecommendationStatus;
  createdAt?: string;
}

export interface Investigation {
  executionId: string;
  title?: string;
  status?: string;
  createdAt?: string;
}

export interface ChatSession {
  executionId: string;
  createdAt?: string;
}

export interface ChatReply {
  content: string;
}

export interface StartInvestigationInput {
  title: string;
  description?: string;
  priority?: RecommendationPriority;
}

export interface StartInvestigationResult {
  accepted: boolean;
  incidentId: string;
  message?: string;
}

/**
 * The capability the router depends on. Both the AWS-backed and mock
 * implementations satisfy this, so the plugin works with or without a real
 * Agent Space.
 */
export interface DevOpsAgentService {
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
    input: StartInvestigationInput,
  ): Promise<StartInvestigationResult>;
}