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
 * Frontend plugin for AWS DevOps Agent: adds a per-component "DevOps Agent" tab
 * (recommendations, investigations, chat, start-investigation), scoped to the
 * component's Agent Space via the aws-devops-agent/space-id annotation.
 */
export { devopsAgentPlugin as default } from './plugin';
export { devOpsAgentApiRef, type DevOpsAgentApi } from './api';
export {
  DEVOPS_AGENT_SPACE_ANNOTATION,
  DEVOPS_AGENT_SERVICE_ANNOTATION,
} from './annotations';
export type {
  Recommendation,
  Investigation,
  ChatReply,
  ChatSession,
  StartInvestigationResult,
} from './types';