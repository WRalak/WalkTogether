# Kubernetes manifests (future scale-out path)

WalkTogether runs on **Docker Compose on a single hardened host** today
(`infrastructure/docker/docker-compose.yml`, provisioned by `infrastructure/terraform`). That is the
supported production path. These manifests exist so the move to Kubernetes (EKS) — **only when load
justifies it** (sustained >70% CPU on the largest sensible single host, or a need for zero-downtime
multi-node deploys) — starts from a reviewed, hardened baseline instead of from scratch. They are
scanned by Checkov in CI so they cannot silently rot.

| Folder | Contents |
| --- | --- |
| `namespace.yaml` | `walktogether` namespace with Pod Security Admission **restricted** enforced |
| `deployments/` | api, worker, platform-admin: non-root, read-only root FS, all capabilities dropped, seccomp `RuntimeDefault`, no service-account token, resource limits, probes, images by digest |
| `services/` | ClusterIP services only (nothing is exposed except through the ingress) |
| `ingress/` | TLS-only ingress for the API and admin hostnames |
| `secrets/` | `ExternalSecret` definitions that pull from AWS Secrets Manager — **no secret values in git** |
| `monitoring/` | default-deny NetworkPolicies + explicit allows, Prometheus `ServiceMonitor`s, PodDisruptionBudgets |

Deploy with Kustomize, overriding image digests from the signed release:

```bash
cd infrastructure/kubernetes
kustomize edit set image ghcr.io/wralak/walktogether-api=ghcr.io/wralak/walktogether-api@sha256:<digest>
kustomize edit set image ghcr.io/wralak/walktogether-platform-admin=ghcr.io/wralak/walktogether-platform-admin@sha256:<digest>
kubectl apply -k .
```

Before using in production also: enforce Cosign signature verification with an admission
controller (Sigstore policy-controller or Kyverno `verifyImages`), run migrations as a one-off Job
with the `walktogether/<env>/migrate` secret, and keep PostgreSQL/Redis on RDS/ElastiCache (never
in-cluster).
