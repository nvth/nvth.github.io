# Cài đặt BurpMCP-Ultra với Codex trên Windows

Hướng dẫn cài thủ công bằng tiếng Việt, không qua CC-switch. Dành cho người đã dùng Burp hoặc mới bắt đầu kết nối Burp với Codex.

Tham khảo cách trình bày từng bước của [mcp-server-codex-for-windows](https://github.com/nvth/mcp-server-codex-for-windows). Repository đó hướng dẫn MCP Server của PortSwigger với Java proxy và Caddy; tài liệu này dùng **BurpMCP-Ultra và mcp-remote**.

## 1. Chuẩn bị

| Thành phần | Mục đích |
| --- | --- |
| Burp Suite Professional | Ghi nhận traffic và thực hiện kiểm thử |
| BurpMCP-Ultra | Cung cấp công cụ Burp qua MCP |
| Node.js LTS, npm/npx | Chạy cầu nối mcp-remote |
| Codex desktop hoặc Codex CLI | Giao việc cho AI |

Luồng kết nối:

```text
Codex → mcp-remote (STDIO → SSE) → BurpMCP-Ultra → Burp Suite
```

Thiết lập này không cần Caddy hoặc file mcp-proxy.jar của PortSwigger. Chỉ kiểm thử trên lab hoặc hệ thống được phép.

## 2. Cài Node.js và Codex

Tải bản **LTS cho Windows** từ [Node.js](https://nodejs.org/). Khi cài, giữ npm và tùy chọn thêm vào PATH. Mở PowerShell mới và kiểm tra:

```powershell
node --version
npm.cmd --version
npx.cmd --version
where.exe npx.cmd
```

Các lệnh phiên bản phải trả về số phiên bản. Lệnh cuối cho biết đường dẫn npx.

Nếu đã có Codex desktop, có thể dùng ngay. Nếu muốn dùng CLI, cài và khởi chạy:

```powershell
npm.cmd install -g @openai/codex
codex --version
codex
```

Hoàn tất đăng nhập theo hướng dẫn trên màn hình. Không cần mở PowerShell bằng quyền Administrator cho các bước kiểm tra.

## 3. Cài BurpMCP-Ultra

1. Mở [Releases của BurpMCP-Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra/releases).
2. Tải file extension có đuôi `.jar` trong Assets; không chọn ZIP mã nguồn.
3. Trong Burp, mở **Extensions → Installed → Add**.
4. Chọn loại **Java**, chọn JAR vừa tải rồi hoàn tất việc nạp extension.
5. Mở **BurpMCP-Ultra → Server**, kiểm tra trạng thái **Running** và sao chép token.

Endpoint mặc định:

```text
http://127.0.0.1:9876/
```

Giữ đường dẫn `/`, không thêm `/sse`. Nếu MCP Server khác đang dùng cổng 9876, tắt server đó hoặc đổi cổng rồi cập nhật cấu hình bên dưới. Xem [hướng dẫn chính thức của Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra#quick-start).

### 3.1. Lấy Bearer token

1. Trong cửa sổ Burp Suite, mở tab **BurpMCP-Ultra**.
2. Chọn **Server** và kiểm tra server đang **Running**.
3. Tìm token kết nối được hiển thị trong tab này, rồi sao chép toàn bộ giá trị token.
4. Thêm tiền tố `Bearer ` trước token khi điền vào `AUTH_HEADER` trong cấu hình Codex.

Ví dụ minh họa: nếu token sao chép là `abc123`, giá trị cần điền là:

```toml
[mcp_servers.burp_ultra.env]
AUTH_HEADER = "Bearer abc123"
```

`abc123` chỉ là ví dụ, phải thay bằng token thật trên máy. Giữa `Bearer` và token có **một khoảng trắng**. Nếu giá trị đã sao chép có sẵn tiền tố `Bearer `, không thêm lần nữa.

Header xác thực được gửi đến Ultra sẽ có dạng:

```http
Authorization: Bearer abc123
```

Trong danh sách `args`, vẫn giữ nguyên `Authorization:${AUTH_HEADER}`; không dán token vào tên biến. Không lấy token từ Proxy history hoặc website đang kiểm thử: đây là token do BurpMCP-Ultra cung cấp để xác thực kết nối MCP.

Nếu không thấy token, kiểm tra đã nạp đúng **BurpMCP-Ultra**, thay vì extension **MCP Server** của PortSwigger. Nếu Ultra chưa nạp thành công, xem lỗi tại **Extensions → Installed** và chọn extension tương ứng. Vị trí Server tab được mô tả trong [hướng dẫn kết nối của Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra#quick-start).

Khi gặp `401 Unauthorized`, đối chiếu token trong cấu hình với token hiện tại ở Server tab. Nếu token đã thay đổi, cập nhật `AUTH_HEADER`, lưu file rồi khởi động lại Codex. Không chia sẻ token thật trong ảnh chụp, log hoặc repository.

## 4. Cấu hình Codex

Mở file dưới đây, thay TEN_NGUOI_DUNG bằng tên tài khoản Windows:

```text
C:\Users\TEN_NGUOI_DUNG\.codex\config.toml
```

Với cấu hình mặc định, có thể mở bằng PowerShell:

```powershell
notepad "$env:USERPROFILE\.codex\config.toml"
```

Nếu bạn đã đặt CODEX_HOME riêng, dùng config.toml trong thư mục đó. Sao lưu file trước khi chỉnh. Giữ nguyên cấu hình khác; nếu đã có mục burp_ultra, sửa mục hiện có thay vì thêm trùng.

```toml
[mcp_servers.burp_ultra]
command = "C:\\Windows\\System32\\cmd.exe"
args = [
  "/d",
  "/c",
  "npx.cmd",
  "-y",
  "mcp-remote",
  "http://127.0.0.1:9876/",
  "--allow-http",
  "--transport",
  "sse-only",
  "--header",
  "Authorization:${AUTH_HEADER}"
]
startup_timeout_sec = 120

[mcp_servers.burp_ultra.env]
AUTH_HEADER = "Bearer THAY_BANG_TOKEN_TRONG_BURP"
```

Thay placeholder bằng token trong Server tab, giữ khoảng trắng sau `Bearer`. Đây là token của extension, không phải API key OpenAI hoặc token đăng nhập website. File cấu hình này chứa thông tin xác thực: không đưa bản có token thật lên GitHub.

`cmd.exe` gọi `npx.cmd` trên Windows. Nếu Windows nằm ở ổ khác, sửa đường dẫn tương ứng. `--transport sse-only` ép dùng SSE: mặc định mcp-remote thử HTTP trước, và chỉ tự chuyển sang SSE khi nhận 404. Trường hợp server trả 400 vì thiếu sessionId cần tùy chọn này. Xem [transport strategies](https://github.com/punkpeye/mcp-remote#transport-strategies).

Codex hỗ trợ cấu hình MCP qua command, args và env trong config.toml. Xem [OpenAI Docs về MCP](https://developers.openai.com/codex/mcp).

## 5. Chạy và xác minh

1. Giữ Burp mở và Ultra ở trạng thái Running.
2. Thoát hoàn toàn Codex rồi mở lại để nạp cấu hình.
3. Trong Codex CLI, dùng `/mcp` để xem kết nối.
4. Trong một task mới, gửi yêu cầu:

> Dùng burp_ultra đọc phiên bản Burp và thông tin extension. Chỉ kiểm tra kết nối, không gửi request đến website.

Kết nối được xác minh khi Codex thực sự gọi công cụ và nhận dữ liệu từ Burp. Chỉ thấy tên server trong danh sách chưa đủ.

**Không cần giữ một cửa sổ PowerShell chạy mcp-remote riêng.** Codex tự khởi chạy cầu nối theo cấu hình. Lần chạy đầu cần mạng để npx tải gói.

## 6. Kiểm tra thủ công khi gặp lỗi

Chạy trong PowerShell, thay token thật tại máy:

```powershell
$env:AUTH_HEADER = 'Bearer THAY_BANG_TOKEN_TRONG_BURP'
npx.cmd -y mcp-remote 'http://127.0.0.1:9876/' --allow-http --transport sse-only --header 'Authorization:${AUTH_HEADER}'
```

Đọc log để xác định bước lỗi. Khi chẩn đoán xong, nhấn **Ctrl+C**. Lệnh chạy riêng kiểm tra cầu nối; bước gọi công cụ từ Codex vẫn cần thực hiện để xác minh toàn bộ.

Chỉ sao chép nội dung trong khối code. URL phải là chuỗi thuần `http://127.0.0.1:9876/`, và tên biến phải là `AUTH_HEADER`, không có dấu gạch chéo ngược trước dấu gạch dưới.

## 7. Lỗi thường gặp

| Thông báo / biểu hiện | Cách xử lý |
| --- | --- |
| `program not found` | Kiểm tra npx.cmd và PATH; mở lại Codex sau khi cài Node |
| `npx.cmd` không được nhận diện | Chạy where.exe npx.cmd; kiểm tra thư mục Node có trong PATH |
| `sessionId query parameter is not provided` | Thêm --transport sse-only; không tự tạo sessionId |
| `401 Unauthorized` | Sao chép lại token hiện tại; kiểm tra tiền tố Bearer và khoảng trắng |
| `Connection refused` | Kiểm tra Ultra Running, đúng host/cổng và không xung đột cổng |
| `connection closed: initialize response` | Chạy lệnh chẩn đoán để lấy nguyên nhân phía trước; đây là lỗi tổng quát |
| Startup timeout | Kiểm tra mạng, tải gói bằng lệnh chẩn đoán; giữ timeout 120 giây |
| Kết nối được nhưng history trống | Dùng trình duyệt đi qua Burp và kiểm tra Proxy → HTTP history |

Khi chia sẻ log, che token và dữ liệu nhạy cảm. Hướng dẫn này chưa khẳng định một phiên bản cụ thể đã được kiểm thử toàn bộ trên mọi máy Windows.

## 8. Bắt đầu sử dụng

Thêm mục tiêu vào Burp Scope, đặt scope mode của Ultra thành `enforce`, rồi dùng trình duyệt qua Burp để tạo traffic. Xem [cơ chế scope của Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra#security-model).

Prompt đầu tiên:

> Đọc HTTP history trong scope. Tổng hợp endpoint, phương thức và tham số. Chỉ phân tích dữ liệu đã ghi, chưa gửi request mới. Che token trong kết quả.

Prompt tiếp theo:

> Từ traffic hiện có, nêu các điểm cần kiểm chứng và request làm bằng chứng. Phân biệt nghi vấn với lỗi đã xác nhận.

Khi cần kiểm thử chủ động, ghi rõ endpoint, thao tác cho phép và giới hạn request. Giữ Burp mở trong suốt phiên làm việc.

## Tài liệu tham khảo

- [Bài hướng dẫn Windows của nvth](https://github.com/nvth/mcp-server-codex-for-windows)
- [BurpMCP-Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra)
- [mcp-remote](https://github.com/punkpeye/mcp-remote)
- [Codex MCP](https://developers.openai.com/codex/mcp)
