chatgpt + antigravity build

## Ẩn / hiện bài viết

Cấu hình tập trung tại `post-visibility.css`. Bài `cve-2026-59880` hiện được ẩn khỏi danh sách Blog và Research, gồm cả tiêu đề Featured và badge của bài.

- Hiện lại bài: xóa selector `[data-post-id="cve-2026-59880"]` cùng khối CSS tương ứng.
- Ẩn bài khác: gắn `data-post-id="slug-bai-viet"` vào thẻ bao ngoài của card và các nhãn liên quan; thêm selector đó vào `post-visibility.css` với `display: none !important`.
- Trang danh sách mới cần nạp `<link rel="stylesheet" href="/post-visibility.css" />` trong `<head>`.
- Commit và triển khai thay đổi để áp dụng lên website.

Đây là chức năng ẩn khỏi danh sách, không phải quyền truy cập: đường dẫn trực tiếp, nội dung Markdown, mã nguồn HTML và kết quả tìm kiếm đã lưu vẫn có thể truy cập. Nội dung gốc được giữ nguyên để hiện lại khi cần. Cấu hình hoạt động cả khi trình duyệt tắt JavaScript.
