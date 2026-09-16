## GitOps in a Windows lab

`GitOps-main` is a set of practical notes around Argo CD. This post brings the main flow together: run Kubernetes locally with Minikube on Docker Desktop, install Argo CD, connect the CLI, deploy a sample application, and deliberately create drift to see how Argo CD returns the cluster to the state defined in Git.

The model is:

```text
Git repository → Argo CD → Kubernetes cluster
       ↑              ↓
  desired state    observe + sync
```

This is suitable for learning, demos, and security labs. Do not expose a local Argo CD instance publicly.

## Prerequisites

| Component | Role |
| --- | --- |
| Windows 10/11 | Host machine |
| WSL 2, preferably Ubuntu | Linux CLI environment |
| Docker Desktop | Minikube container runtime |
| Minikube | Local Kubernetes cluster |
| `kubectl` | Cluster administration |
| Argo CD and Argo CD CLI | GitOps controller and client |

In Docker Desktop, open **Settings → Resources → WSL Integration**, enable integration for the distro you use, then Apply/Restart. Confirm Docker is working before starting Minikube.

## 1. Start Minikube

Install Minikube and `kubectl` in WSL 2 using their official instructions, then choose Docker as the driver:

```bash
minikube start --driver=docker
kubectl get nodes
```

The expected result is a node in `Ready` state. Do not run Minikube as root; that can create permission differences between WSL, Docker, and Kubernetes configuration files.

## 2. Install Argo CD

Create a namespace and apply the official manifest:

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

Wait for the Pods to become ready:

```bash
kubectl get pods -n argocd
```

## 3. Open the Argo CD UI

Forward Argo CD's HTTPS service to local port `9889`:

```bash
kubectl port-forward svc/argocd-server -n argocd 9889:443
```

Open [https://localhost:9889](https://localhost:9889). Retrieve the initial admin password from the Secret, and never put the real password in a README, log, or Git repository:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

Sign in as `admin`, then change the password immediately. Because this is a local endpoint with a self-signed certificate, the browser may show a certificate warning.

## 4. Connect the Argo CD CLI in WSL

Install the Linux Argo CD CLI into `/usr/local/bin`, make it executable, and check it:

```bash
sudo curl -sSL -o /usr/local/bin/argocd \
  https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo chmod +x /usr/local/bin/argocd
argocd version --client
```

Because the server is forwarded to `localhost:9889`, log in with:

```bash
argocd login localhost:9889 \
  --username admin \
  --password 'REPLACE_WITH_PASSWORD' \
  --insecure
```

`--insecure` is appropriate only for the local lab endpoint. Do not use it to hide certificate problems in production.

## 5. Create the Guestbook Application

Create an Application in the UI with **New App → Edit as YAML**, or import this manifest:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: test-guestbook
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: guestbook
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

After **Save/Create**, Argo CD watches the Git source and syncs manifests into the cluster. `prune` removes resources that are no longer in Git, while `selfHeal` attempts to correct drift without a manual Sync click.

## 6. Create a user and define permissions

Edit Argo CD's ConfigMap:

```bash
kubectl edit cm argocd-cm -n argocd
```

Add a secondary account, for example `dev` with login and API-key capability:

```yaml
data:
  accounts.dev: login, apiKey
```

Check the account list:

```bash
argocd account list
```

Set a new password for the account using the current admin password and a separate password for `dev`:

```bash
argocd account update-password \
  --account dev \
  --current-admin-password 'ADMIN_PASSWORD' \
  --new-password 'DEV_PASSWORD'
```

Next, edit the RBAC ConfigMap:

```bash
kubectl edit cm argocd-rbac-cm -n argocd
```

This example gives `dev` the minimum permissions to view and sync Applications:

```yaml
data:
  policy.csv: |
    p, dev, applications, get, */*, allow
    p, dev, applications, sync, */*, allow
    p, dev, projects, get, *, allow
```

`data` must be at the same level as `metadata`. In a real environment, scope the project and resources instead of using the broad lab example.

## 7. Deliberately create drift

Assume Git declares `replicas: 2`. Change the live state:

```bash
kubectl scale deployment web-app --replicas=3
```

Git still says the desired state is 2, while the cluster now has 3 replicas. Argo CD marks the Application `OutOfSync`. This is the core GitOps idea: a direct cluster change does not become the source of truth.

With **Manual Sync**, click **Sync** in the dashboard to make Argo CD read Git again and return the cluster to the desired state. With **Auto-Sync + Self-Heal**, the controller can correct drift automatically according to the declared policy.

## Revision and rollback

`targetRevision` defines where Argo CD pulls from:

| Revision | Meaning |
| --- | --- |
| `HEAD` | Latest commit on the default branch |
| Branch | A flow such as `dev`, `staging`, or `prod` |
| Tag | A pinned release, such as `v1.0.0` |
| Commit SHA | A fixed commit |

Argo CD keeps sync history for review and rollback. Durable changes should still be made in Git and synced again. A UI-only rollback can leave the cluster on an older version while Git still declares the newer one, creating another `OutOfSync` state.

## Lab operations checklist

- Do not run Minikube as root.
- Change the `admin` password after the first login.
- Never commit real passwords, tokens, kubeconfig files, or Secrets.
- Do not expose local Argo CD publicly.
- Keep RBAC narrow for the project and actions that are actually needed.
- Treat Git as the source of truth; use direct cluster changes only to observe drift.

## Closing note

An Argo CD lab on WSL2 makes GitOps visible: Git defines desired state, Argo CD observes and syncs, and Kubernetes holds the live state. The drift, revision, and RBAC exercises connect the concepts to concrete operations instead of stopping at dashboard installation.
