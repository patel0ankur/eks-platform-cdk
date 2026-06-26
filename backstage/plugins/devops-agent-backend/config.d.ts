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

export interface Config {
  /**
   * Configuration for the AWS DevOps Agent backend plugin.
   * @visibility backend
   */
  devOpsAgent?: {
    /**
     * When true, the plugin serves deterministic mock data instead of calling
     * AWS. Use for local development and CI where no Agent Space is provisioned.
     * @visibility backend
     */
    mock?: boolean;

    /**
     * AWS region of the DevOps Agent Spaces. Optional — falls back to the
     * standard AWS region resolution (AWS_REGION, shared config, etc.).
     * @visibility backend
     */
    region?: string;

    /**
     * Optional IAM role ARN to assume for cross-account access to the Agent
     * Space. Credentials otherwise come from the default AWS provider chain
     * (env, shared profile, EKS Pod Identity / IRSA, ECS task role, ...).
     * @visibility backend
     */
    assumeRoleArn?: string;

    /**
     * How the agent resolves the calling user's identity for chat. Defaults to
     * IAM. Use IDC for IAM Identity Center or IDP for an external OIDC provider.
     * @visibility backend
     */
    userType?: 'IAM' | 'IDC' | 'IDP';

    /**
     * Per-Agent-Space generic-webhook configuration, keyed by Agent Space id.
     * Required only to support the "Start investigation" action. Each webhook
     * is created in the AWS DevOps Agent console (Capabilities -> Webhook).
     * @visibility backend
     */
    spaces?: {
      [agentSpaceId: string]: {
        webhook?: {
          /**
           * Generic webhook endpoint URL.
           * @visibility backend
           */
          url: string;
          /**
           * HMAC secret for the generic webhook.
           * @visibility secret
           */
          secret: string;
        };
      };
    };
  };
}