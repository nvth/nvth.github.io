## Vì sao cần một lớp alias cho Command Prompt?

Command Prompt vẫn rất hữu ích trên Windows, nhưng thói quen làm việc thường bị ngắt khi chuyển qua lại giữa `dir` và `ls`, `type` và `cat`, hoặc cú pháp xóa file của Windows và Linux. Project `cmd-aliases-main` giải quyết phần ma sát đó bằng một lớp alias mỏng: giữ nguyên `cmd.exe`, thêm các lệnh quen thuộc và tạo wrapper cho những lệnh cần xử lý tham số.

Mục tiêu không phải biến Command Prompt thành Linux. Mục tiêu là giúp người đã quen terminal Linux làm việc nhanh hơn trên một máy Windows mà không phải cài thêm shell mới.

## Project cài những gì?

Khi chạy script thiết lập, project tạo hai lớp:

| Thành phần | Vai trò |
| --- | --- |
| `C:\alias\cmd.cmd` | File được Command Prompt nạp qua AutoRun để đăng ký alias |
| `%USERPROFILE%\.cmd-aliases\bin` | Wrapper của người dùng hiện tại |
| `C:\ProgramData\cmd-aliases\bin` | Wrapper dùng khi cài cho toàn máy |
| Registry AutoRun | Tự nạp alias ở mỗi cửa sổ Command Prompt mới |

Các alias đơn giản gọi thẳng lệnh Windows. Ví dụ `ls` gọi `dir /b`, `pwd` gọi `cd`, còn `cat` gọi `type`. Các lệnh như `rm`, `cp`, `mkdir`, `rmdir` và `find` được tạo thành file `.cmd` riêng để xử lý tùy chọn và đường dẫn.

## Cài cho tài khoản hiện tại

Đây là lựa chọn phù hợp để thử nghiệm. Tải [setup-aliases-full.cmd](/bdata/setup-aliases-full.cmd) rồi nhấp đúp; script sẽ cài vào profile hiện tại và không cần quyền Administrator.

Sau khi script báo hoàn tất, đóng rồi mở lại Command Prompt. Kiểm tra nhanh:

```cmd
ls
pwd
cat README.md
find . -name *.md
```

Alias chỉ được nạp trong các cửa sổ `cmd.exe` mới. Một cửa sổ đang mở từ trước sẽ không tự nhận thay đổi AutoRun.

## Cài cho toàn bộ người dùng

Mở Command Prompt bằng quyền Administrator rồi chạy:

```cmd
setup-aliases-full.cmd /all
```

Script sẽ dùng `C:\ProgramData\cmd-aliases` làm thư mục cài đặt và ghi AutoRun vào nhánh máy:

```text
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Command Processor
```

Tùy chọn `/system` và `/machine` cũng được script chấp nhận như alias của `/all`. Nếu không có quyền quản trị, script dừng lại trước khi cài chế độ toàn máy.

## Bảng lệnh nhanh

| Lệnh kiểu Linux | Lệnh hoặc wrapper Windows | Ghi chú |
| --- | --- | --- |
| `ls`, `ll`, `la` | `dir /b`, `dir`, `dir /a` | Xem file và thư mục |
| `pwd` | `cd` | In thư mục hiện tại |
| `cat` | `type` | Đọc nội dung file |
| `less` | `more` | Đọc file theo từng trang |
| `grep`, `grepr` | `findstr` | Tìm text; `grepr` tìm đệ quy |
| `ps`, `top` | `tasklist`, `tasklist /v` | Xem process |
| `kill` | `taskkill /PID ... /F` | Dừng process theo PID |
| `ss` | `netstat -ano` | Xem socket và PID |
| `ip`, `ifconfig` | `ipconfig` | Xem cấu hình mạng |
| `cp`, `mv` | Wrapper `cp.cmd`, `move` | Sao chép hoặc di chuyển |
| `rm`, `mkdir`, `rmdir`, `find` | Wrapper `.cmd` | Hỗ trợ cú pháp quen thuộc hơn |

## Điểm cần nhớ khi dùng wrapper

Wrapper không phải bản sao đầy đủ của GNU coreutils. Nó chỉ tập trung vào các thao tác thường gặp trong Command Prompt.

Với `rm`, tùy chọn `-r` cho phép xóa thư mục đệ quy và `-f` buộc xóa file. Nếu truyền thư mục mà không có `-r`, wrapper từ chối thao tác. Hãy kiểm tra đường dẫn trước khi dùng lệnh xóa:

```cmd
dir target
rm -rf target
```

`cp` yêu cầu `-r`, `-R` hoặc `-a` khi nguồn là thư mục. `mkdir` và `rmdir` nhận `-p` để tương thích với thói quen Linux, còn `find` hỗ trợ mẫu `-name` cơ bản.

## Gỡ cài đặt

Tải và chạy [uninstall-aliases.cmd](/bdata/uninstall-aliases.cmd):

```cmd
uninstall-aliases.cmd
```

Script gỡ AutoRun và các file alias đã tạo. Sau đó mở lại Command Prompt để môi trường mới không còn nạp cấu hình cũ.

## Mở rộng alias

File trung tâm là `C:\alias\cmd.cmd`. Có thể thêm một dòng `doskey` theo mẫu:

```cmd
doskey c=cls
doskey croot=cd /d C:\workspace
```

Sau khi chỉnh file, chỉ các cửa sổ `cmd.exe` mở mới nhận alias. Nên giữ alias ngắn, dễ nhớ và tránh đặt tên trùng với chương trình quan trọng trong `PATH`.

## Kết luận

`cmd-aliases-main` là một tiện ích nhỏ nhưng thực tế: cài nhanh, không thay đổi shell mặc định và gom những lệnh terminal hay dùng vào một quy ước quen thuộc. Điểm quan trọng nhất là hiểu rõ wrapper đang làm gì, đặc biệt với thao tác xóa, trước khi đưa nó vào môi trường làm việc hằng ngày.
