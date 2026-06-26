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
 * Data contract between the DevOps Agent frontend and backend plugins. These
 * are intentionally a trimmed, UI-friendly projection of the AWS DevOps Agent
 * API shapes — the backend maps the SDK responses onto these.
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
  /** Concatenated agent reply text for the message. */
  content: string;
}

/** Result of triggering an investigation via the space webhook. */
export interface StartInvestigationResult {
  accepted: boolean;
  incidentId: string;
  message?: string;
}