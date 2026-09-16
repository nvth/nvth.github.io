## GitOps trong một lab Windows

`GitOps-main` là bộ ghi chú thực hành xoay quanh Argo CD. Bài này gom lại luồng chính: chạy Kubernetes local bằng Minikube trên Docker Desktop, cài Argo CD, kết nối CLI, triển khai một ứng dụng mẫu và cố tình tạo drift để quan sát cách Argo CD đưa cluster về trạng thái trong Git.

Mô hình:

```text
Git repository → Argo CD → Kubernetes cluster
       ↑              ↓
  desired state    observe + sync
```

Lab phù hợp cho học tập, demo GitOps hoặc security lab. Không nên expose Argo CD public từ môi trường local.

## Yêu cầu

| Thành phần | Vai trò |
| --- | --- |
| Windows 10/11 | Máy chạy lab |
| WSL 2, khuyến nghị Ubuntu | Môi trường chạy CLI Linux |
| Docker Desktop | Container runtime cho Minikube |
| Minikube | Kubernetes cluster local |
| `kubectl` | Quản lý cluster |
| Argo CD và Argo CD CLI | GitOps controller và client |

Trong Docker Desktop, mở **Settings → Resources → WSL Integration**, bật integration cho distro đang dùng rồi Apply/Restart. Kiểm tra Docker đã hoạt động trước khi khởi tạo Minikube.

## 1. Khởi tạo Minikube

Trong WSL 2, cài Minikube và `kubectl` theo hướng dẫn chính thức, sau đó chọn Docker làm driver:

```bash
minikube start --driver=docker
kubectl get nodes
```

Kết quả mong muốn là một node ở trạng thái `Ready`. Không chạy Minikube bằng quyền root; điều đó dễ tạo ra khác biệt quyền giữa WSL, Docker và các file cấu hình Kubernetes.

## 2. Cài Argo CD

Tạo namespace riêng rồi cài manifest chính thức:

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

Đợi các Pod sẵn sàng:

```bash
kubectl get pods -n argocd
```

## 3. Mở Argo CD UI

Port-forward service HTTPS của Argo CD sang cổng local `9889`:

```bash
kubectl port-forward svc/argocd-server -n argocd 9889:443
```

Mở [https://localhost:9889](https://localhost:9889). Lấy mật khẩu admin ban đầu từ Secret, không ghi mật khẩu thật vào README, log hoặc Git:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

Đăng nhập lần đầu bằng user `admin`, sau đó đổi mật khẩu ngay. Vì đây là endpoint local với chứng chỉ self-signed, trình duyệt có thể hiển thị cảnh báo chứng chỉ.

## 4. Kết nối Argo CD CLI trong WSL

Cài Argo CD CLI Linux vào `/usr/local/bin`, cấp quyền chạy rồi kiểm tra:

```bash
sudo curl -sSL -o /usr/local/bin/argocd \
  https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo chmod +x /usr/local/bin/argocd
argocd version --client
```

Vì server đang được forward tới `localhost:9889`, đăng nhập bằng:

```bash
argocd login localhost:9889 \
  --username admin \
  --password 'THAY_BANG_MAT_KHAU' \
  --insecure
```

`--insecure` chỉ phù hợp cho endpoint local của lab. Không dùng tùy chọn này để che giấu lỗi chứng chỉ trên môi trường production.

## 5. Tạo Application Guestbook

Có thể tạo Application từ UI bằng **New App → Edit as YAML**, hoặc import manifest sau:

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

Sau khi **Save/Create**, Argo CD theo dõi source Git và đồng bộ manifest vào cluster. `prune` dọn tài nguyên không còn trong Git; `selfHeal` cố gắng sửa drift mà không cần bấm Sync thủ công.

## 6. Tạo user và phân quyền

Sửa ConfigMap của Argo CD:

```bash
kubectl edit cm argocd-cm -n argocd
```

Thêm account phụ, ví dụ `dev` có quyền đăng nhập và tạo API key:

```yaml
data:
  accounts.dev: login, apiKey
```

Kiểm tra danh sách account:

```bash
argocd account list
```

Đặt mật khẩu mới cho account bằng mật khẩu admin hiện tại và một mật khẩu riêng cho `dev`:

```bash
argocd account update-password \
  --account dev \
  --current-admin-password 'MAT_KHAU_ADMIN' \
  --new-password 'MAT_KHAU_DEV'
```

Tiếp theo, sửa RBAC ConfigMap:

```bash
kubectl edit cm argocd-rbac-cm -n argocd
```

Ví dụ policy tối thiểu cho phép `dev` xem và sync Application:

```yaml
data:
  policy.csv: |
    p, dev, applications, get, */*, allow
    p, dev, applications, sync, */*, allow
    p, dev, projects, get, *, allow
```

`data` phải cùng cấp với `metadata`. Trong môi trường thật, giới hạn project và resource thay vì cấp `*/ *` rộng như ví dụ lab.

## 7. Cố tình tạo drift để hiểu GitOps

Giả sử manifest trong Git khai báo `replicas: 2`. Thử thay đổi live state:

```bash
kubectl scale deployment web-app --replicas=3
```

Git vẫn nói desired state là 2, còn cluster đang có live state là 3. Argo CD đánh dấu Application `OutOfSync`. Đây là điểm cốt lõi của GitOps: thay đổi trực tiếp trong cluster không trở thành nguồn sự thật.

Với **Manual Sync**, nhấn **Sync** trong dashboard để Argo CD đọc lại Git và đưa cluster về trạng thái mong muốn. Với **Auto-Sync + Self-Heal**, controller có thể tự sửa drift theo policy đã khai báo.

## Revision và rollback

`targetRevision` xác định Argo CD sẽ pull từ đâu:

| Revision | Ý nghĩa |
| --- | --- |
| `HEAD` | Commit mới nhất của branch mặc định |
| Branch | Luồng như `dev`, `staging` hoặc `prod` |
| Tag | Một phiên bản đã chốt, ví dụ `v1.0.0` |
| Commit SHA | Khóa cố định vào một commit |

Argo CD giữ lịch sử các lần sync để xem lại và rollback. Tuy nhiên, thay đổi bền vững nên được thực hiện trong Git rồi sync lại. Rollback chỉ trên UI có thể khiến cluster quay về phiên bản cũ trong khi Git vẫn giữ phiên bản mới, tạo thêm `OutOfSync`.

## Checklist vận hành lab

- Không chạy Minikube bằng root.
- Đổi mật khẩu `admin` ngay sau lần đăng nhập đầu.
- Không commit password, token, kubeconfig hoặc Secret thật.
- Không expose Argo CD public từ lab local.
- Giữ policy RBAC hẹp theo project và hành động cần thiết.
- Xem Git là source of truth; thay đổi cluster trực tiếp chỉ dùng để quan sát drift.

## Kết luận

Lab Argo CD trên WSL2 là cách gọn để thấy GitOps hoạt động bằng mắt: Git định nghĩa desired state, Argo CD quan sát và sync, còn Kubernetes giữ live state. Phần demo drift, revision và RBAC giúp nối khái niệm với thao tác cụ thể thay vì chỉ dừng ở việc cài dashboard.
