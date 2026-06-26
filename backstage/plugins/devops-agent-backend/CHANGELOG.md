# @your-scope/backstage-plugin-aws-devops-agent-backend

## 0.1.0

### Minor Changes

- Initial release. Backend for the AWS DevOps Agent plugin: proxies the AWS
  DevOps Agent API (recommendations, investigations, chat) using the default AWS
  credential provider chain, and triggers investigations via an HMAC-signed
  generic webhook. Includes a `mock` mode for local development without AWS.
