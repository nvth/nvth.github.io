## Bài toán kết nối

Burp Suite giữ lại HTTP history rất tốt, còn Codex CLI có thể giúp đọc và phân tích lịch sử đó. Phần khó nằm ở lớp kết nối giữa hai công cụ. Repository `mcp-server-codex-for-windows-main` mô tả một cấu hình Windows dùng MCP Server của PortSwigger, Java proxy và Caddy reverse proxy.

Luồng hoàn chỉnh:

```text
Browser → Burp Suite → MCP Server → Caddy → Codex CLI
```

Codex không gửi request trực tiếp trong luồng này. Nó đọc dữ liệu mà Burp đã ghi lại thông qua MCP, vì vậy có thể bắt đầu bằng phân tích thụ động trước.

> Chỉ dùng cấu hình này với lab, hệ thống do bạn sở hữu hoặc mục tiêu mà bạn có quyền kiểm thử rõ ràng.

## Chuẩn bị

| Thành phần | Mục đích |
| --- | --- |
| Burp Suite Professional | Ghi nhận và hiển thị browser traffic |
| MCP Server extension | Mở điểm kết nối MCP trong Burp |
| Codex CLI | Gửi yêu cầu phân tích tới Codex |
| Caddy | Reverse proxy cho endpoint MCP |
| Java 17 trở lên | Chạy `mcp-proxy.jar` |
| Node.js | Cài Codex CLI qua npm |

## 1. Cài Codex CLI

Cài Node.js từ [trang tải chính thức](https://nodejs.org/en/download/current), sau đó mở Command Prompt mới và chạy:

```cmd
npm install -g @openai/codex
codex --version
```

Nếu lệnh đầu trả về lỗi quyền, cài Node.js cho tài khoản hiện tại hoặc dùng cửa sổ Administrator theo chính sách máy của bạn. Chỉ cần kiểm tra có số phiên bản trước khi chuyển sang bước MCP.

## 2. Cài MCP Server trong Burp

Mở Burp Suite Professional, vào **BApp Store**, tìm `MCP` và cài **MCP Server**. Trong tab **MCP**, chọn **Extract server proxy jar** để tạo file `mcp-proxy.jar`.

Ghi lại đường dẫn thật của file JAR. Đường dẫn này sẽ được dùng trong `config.toml`; không nên đoán hoặc dùng đường dẫn mẫu khi cấu hình.

Mặc định MCP Server của Burp lắng nghe tại:

```text
127.0.0.1:9876
```

## 3. Cấu hình Codex

Mở file:

```text
C:\Users\TEN_NGUOI_DUNG\.codex\config.toml
```

Thêm cấu hình sau, thay `C:\PATH\TO\mcp-proxy.jar` bằng đường dẫn thật:

```toml
[mcp_servers.burp]
command = "java"
args = ["-jar", "C:\\PATH\\TO\\mcp-proxy.jar", "--sse-url", "http://127.0.0.1:19876"]
```

Trong TOML, dấu gạch chéo ngược của đường dẫn Windows phải được viết thành `\\`. Giữ nguyên các mục khác trong file nếu chúng đã tồn tại.

## 4. Tạo Caddy reverse proxy

Cài Caddy cho Windows, đặt `caddy.exe` vào một thư mục có trong `PATH`, rồi tạo file `Caddyfile`:

```caddyfile
:19876

reverse_proxy 127.0.0.1:9876 {
    header_up Host "127.0.0.1:9876"
    header_up Origin "http://127.0.0.1:9876"
    header_up -User-Agent
    header_up -Accept
    header_up -Accept-Encoding
    header_up -Connection
}
```

Caddy nhận kết nối ở cổng `19876` và chuyển tiếp tới MCP Server ở `9876`. Vì vậy `--sse-url` trong cấu hình Codex phải trỏ tới `http://127.0.0.1:19876`, không phải endpoint đích phía Burp.

Khởi chạy Caddy trong thư mục chứa `Caddyfile`:

```cmd
caddy run --config Caddyfile
```

Nếu chạy từ thư mục khác, truyền đường dẫn đầy đủ tới file cấu hình.

## 5. Bật MCP và kiểm tra

Trong Burp, quay lại tab **MCP** và bật MCP Server. Mở Command Prompt khác, chạy `codex`, rồi dùng:

```text
/mcp
```

Nếu thấy server `burp`, Codex đã đọc được cấu hình. Lần kiểm tra đầu tiên nên chỉ xác minh kết nối:

> Read the HTTP history in Burp and report the available methods and hosts. Do not send new requests.

Chỉ thấy tên server trong danh sách chưa đủ. Hãy yêu cầu Codex gọi công cụ và trả về dữ liệu thật từ Burp để xác minh toàn bộ đường đi.

## 6. Phân tích traffic một cách có kiểm soát

Mở trình duyệt đã cấu hình proxy qua Burp và truy cập lab được phép kiểm thử. Sau khi traffic xuất hiện trong **Proxy → HTTP history**, có thể yêu cầu:

```text
Read the HTTP history in Burp and identify the highest-risk findings.
Separate confirmed evidence from hypotheses and do not send new requests.
```

Một quy trình an toàn nên bắt đầu bằng việc đọc lịch sử, tổng hợp endpoint/phương thức/tham số, sau đó mới quyết định có cần kiểm thử chủ động hay không. Khi cần gửi request mới, nêu rõ endpoint, giới hạn request và phạm vi được phép.

## 7. Xử lý lỗi thường gặp

| Biểu hiện | Kiểm tra |
| --- | --- |
| Không thấy `burp` trong `/mcp` | MCP Server đã bật, Caddy đang chạy và JAR đúng đường dẫn |
| Caddy không tìm thấy `Caddyfile` | Chạy trong đúng thư mục hoặc dùng đường dẫn đầy đủ |
| Codex không đọc được dữ liệu | Trình duyệt có đi qua Burp và HTTP history có request mới |
| Java không chạy được JAR | Kiểm tra `java -version` và dùng Java 17 trở lên |
| Kết nối thất bại | Đối chiếu cổng `9876` của Burp và `19876` của Caddy |

Khi chia sẻ log, che token, cookie, Authorization header và dữ liệu nhạy cảm. Không đưa file cấu hình cá nhân lên repository nếu trong đó có thông tin xác thực.

## MCP Server và BurpMCP-Ultra khác nhau thế nào?

Bài này dùng MCP Server của PortSwigger, `mcp-proxy.jar` và Caddy. Nếu bạn đang dùng BurpMCP-Ultra với `mcp-remote` và Bearer token, xem [hướng dẫn BurpMCP-Ultra với Codex trên Windows](/blogs/burpmcp-ultra-codex-windows/); đó là một luồng cấu hình khác và không cần Caddy.

## Kết luận

Mô hình Java proxy + Caddy phù hợp khi bạn muốn một đường kết nối rõ ràng giữa Burp MCP và Codex CLI trên Windows. Ba điểm cần nhớ là giữ đúng cặp cổng `9876 → 19876`, dùng đường dẫn JAR thật trong TOML và bắt đầu bằng phân tích HTTP history thụ động trong phạm vi được phép.
