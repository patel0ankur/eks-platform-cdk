import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";
import { config } from "./config";

export interface PlatformBootstrapStackProps extends cdk.StackProps {
  /** The EKS cluster, imported with kubectl access (from EksStack). */
  readonly cluster: eks.ICluster;
}

/**
 * PlatformBootstrapStack — the single GitOps entry point for the platform.
 *
 * Applies ONE ArgoCD ApplicationSet that scans `gitops/platform/*` in the repo
 * and creates an Application per subfolder. After this is in place, adding a
 * platform component (Keycloak, Backstage, ingress, ...) is just adding a
 * folder under gitops/platform/ — no CDK change and no manual kubectl.
 *
 * This keeps platform infrastructure (managed here, via this repo) separate
 * from developer applications (managed elsewhere, e.g. gitops/applications/).
 *
 * Applied via KubernetesManifest against an imported cluster so it can live in
 * its own stack and depend on the ArgoCD capability being active first (the
 * ApplicationSet CRD is provided by that capability).
 */
export class PlatformBootstrapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PlatformBootstrapStackProps) {
    super(scope, id, props);

    new eks.KubernetesManifest(this, "PlatformApplicationSet", {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: "argoproj.io/v1alpha1",
          kind: "ApplicationSet",
          metadata: {
            name: "platform",
            namespace: "argocd",
          },
          spec: {
            goTemplate: true,
            generators: [
              {
                git: {
                  repoURL: config.gitops.repoUrl,
                  revision: config.gitops.revision,
                  // One Application per immediate subfolder of gitops/platform.
                  directories: [{ path: "gitops/platform/*" }],
                },
              },
            ],
            template: {
              metadata: {
                // Folder name becomes the Application + namespace name.
                name: "{{.path.basename}}",
              },
              spec: {
                project: "default",
                source: {
                  repoURL: config.gitops.repoUrl,
                  targetRevision: config.gitops.revision,
                  path: "{{.path.path}}",
                },
                destination: {
                  name: "in-cluster",
                  namespace: "{{.path.basename}}",
                },
                syncPolicy: {
                  automated: { prune: true, selfHeal: true },
                  syncOptions: ["CreateNamespace=true"],
                },
              },
            },
          },
        },
      ],
    });
  }
}
