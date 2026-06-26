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

import { Entity } from '@backstage/catalog-model';

/**
 * Annotation that links a catalog entity to its AWS DevOps Agent Space. The tab
 * only appears for entities that declare this, mirroring how the Kubernetes and
 * ArgoCD plugins gate their tabs on an annotation.
 */
export const DEVOPS_AGENT_SPACE_ANNOTATION = 'aws-devops-agent/space-id';

/**
 * Optional annotation linking the entity to a specific DevOps Agent "Service"
 * (the agent's notion of an application/component). When present it scopes reads
 * to that service; when absent the tab shows space-level data.
 */
export const DEVOPS_AGENT_SERVICE_ANNOTATION = 'aws-devops-agent/service-id';

/** The DevOps Agent Space id for an entity, if any. */
export const getDevOpsAgentSpaceId = (entity: Entity): string | undefined =>
  entity.metadata.annotations?.[DEVOPS_AGENT_SPACE_ANNOTATION];

/** The DevOps Agent Service id for an entity, if any. */
export const getDevOpsAgentServiceId = (entity: Entity): string | undefined =>
  entity.metadata.annotations?.[DEVOPS_AGENT_SERVICE_ANNOTATION];

/** True when the entity is wired to a DevOps Agent Space (gates the tab). */
export const isDevOpsAgentAvailable = (entity: Entity): boolean =>
  Boolean(getDevOpsAgentSpaceId(entity));