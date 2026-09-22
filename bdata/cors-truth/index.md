## Tóm tắt ngắn

CORS không phải cơ chế xác thực. Đây là giao thức do trình duyệt thực thi để kiểm soát scripted cross-origin request nào có thể tiếp tục và liệu JavaScript ở một origin có được **đọc** response của origin khác hay không. Nó không thay thế authentication, authorization hoặc CSRF defense ở server: một số cross-origin request, gồm form và simple request, vẫn có thể đến server dù response của chúng không đọc được.

Sự khác biệt đó biến một shortcut nhỏ phía server thành lỗi lộ dữ liệu nghiêm trọng:

```text
Access-Control-Allow-Origin: <Origin của request>
Access-Control-Allow-Credentials: true
```

Nếu server phản chiếu mọi origin do client cung cấp và trình duyệt của nạn nhân gửi credential phù hợp, một trang do attacker kiểm soát có thể đọc response API đã được xác thực. Lab local minh họa đúng cấu hình này. Chỉ thực hành trên hệ thống bạn sở hữu hoặc được cấp quyền kiểm thử rõ ràng.

## Trước hết, tách ba quy tắc của trình duyệt

Cách dễ nhất để hiểu CORS là tách riêng các câu hỏi sau:

| Câu hỏi | Thành phần quyết định | Ví dụ |
| --- | --- | --- |
| Có phải cross-origin không? | Bộ ba origin: scheme, host và port | `http://localhost:8081` và `http://localhost:3000` khác origin vì khác port. |
| Credential có được gửi không? | Chế độ credentials của Fetch, thuộc tính cookie, chính sách trình duyệt và cơ chế xác thực | Cookie có `SameSite` hạn chế có thể không đi cùng một cross-site fetch. |
| JavaScript có đọc được response không? | CORS response headers từ server đích | `Access-Control-Allow-Origin` phải khớp origin gọi; đọc có credential còn cần `Access-Control-Allow-Credentials: true`. |

Server chỉ thấy HTTP request, không thấy một tín hiệu tin cậy đặc biệt nào. Với simple CORS request, trình duyệt đưa ra quyết định chia sẻ response sau khi nhận response; request có preflight bổ sung một CORS check trước request thực tế. Curl và Burp có thể gửi bất kỳ header `Origin` nào, nên rất tốt để xác nhận hành vi của server—nhưng không tự chứng minh rằng trang attacker có thể đọc response trong trình duyệt.

## Lab chứng minh điều gì

Handler cố ý có lỗi lấy header `Origin` của request và trả lại thành `Access-Control-Allow-Origin`:

```js
function setCorsHeaders(response, request) {
  const origin = request.headers.origin;
  if (!origin) return;

  // Cố ý có lỗi: chấp nhận mọi origin do client kiểm soát.
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Vary", "Origin");
}
```

Ví dụ, một request đã xác thực gửi tới lab local có thể tạo ra:

```http
GET /api/account HTTP/1.1
Host: localhost:3000
Origin: https://attacker.example
Cookie: lab_session=authenticated-user
```

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://attacker.example
Access-Control-Allow-Credentials: true
Vary: Origin

{
  "account": "demo-user",
  "apiKey": "LAB_ONLY_NOT_A_REAL_SECRET"
}
```

Server cũng phản chiếu `Origin: null`. Đây không phải fallback an toàn: các context có opaque origin có thể dùng giá trị đó, vì vậy nên từ chối nó trừ khi có use case rất hẹp, được thiết kế và ghi nhận rõ ràng.

Raw request chứng minh lỗi cốt lõi: backend dùng input không đáng tin để đưa ra quyết định allow. Cookie trong curl chỉ mô phỏng một request đã xác thực; JavaScript không thể tự gắn header `Cookie`.

## Khi nào cấu hình này trở thành lộ dữ liệu

Để một trang trong trình duyệt đọc được response của lab, toàn bộ các điều kiện sau phải đồng thời đúng:

1. Trang chạy ở origin mà server sẽ phản chiếu, chẳng hạn `http://localhost:8081` trong ảnh.
2. Request dùng `credentials: "include"` cho luồng cross-origin dựa trên cookie.
3. Trình duyệt thực sự gửi credential phù hợp theo chính sách cookie và trình duyệt.
4. Response trả về đúng origin gọi trong `Access-Control-Allow-Origin` và giá trị `true` viết thường trong `Access-Control-Allow-Credentials`.
5. API response chứa dữ liệu mà origin gọi không nên nhận được.

Fetch Standard yêu cầu origin khớp chính xác đối với CORS có credential. Không thể dùng wildcard (`*`) cho response được chia sẻ kèm credential. Giá trị được phản chiếu của lab đáp ứng điều kiện khớp chính xác cho mọi origin đầu vào, nên nó nguy hiểm.

Ảnh dùng hai port trên `localhost`. Chúng khác origin nhưng có thể được xem là same-site theo chính sách cookie. Không nên suy rộng kết quả local đó sang remote domain: attacker ở `https://attacker.example` thường cần trình duyệt gửi credential qua site khác, ví dụ do một chính sách cookie cố ý cho phép cross-site, một browser credential phù hợp khác, hoặc quyền kiểm soát một same-site origin. Hãy kiểm tra điều kiện này trong trình duyệt thật của môi trường đang đánh giá.

## PoC trong trình duyệt cho lab

Sau khi chạy lab tại `http://localhost:3000`, phục vụ một trang vô hại do bạn kiểm soát tại `http://localhost:8081`. Hãy vào lab trước để tạo demo cookie, sau đó chạy đoạn mã này từ trang ở port 8081:

```js
(async () => {
  const response = await fetch("http://localhost:3000/api/account", {
    credentials: "include",
  });

  console.log("HTTP status:", response.status);
  console.log(await response.text());
})().catch(console.error);
```

Nếu trình duyệt đã gửi lab cookie, origin đã được phản chiếu và CORS check thành công, console sẽ hiển thị JSON response.

![PoC trong trình duyệt với CORS lab local](/blogs/cors-truth/acao-arbitrary.png)

Đây là tác động chính: CORS không cấp cho attacker một danh tính mới. Nó cho phép JavaScript do attacker kiểm soát đọc dữ liệu mà trình duyệt của nạn nhân vốn đã được phép request.

## CORS không phải CSRF

CORS và CSRF thường xuất hiện trong cùng một finding, nhưng chúng trả lời các câu hỏi khác nhau.

| Chủ đề | Câu hỏi chính | Hệ quả điển hình |
| --- | --- | --- |
| CORS | JavaScript từ origin này có đọc được response không? | Lộ dữ liệu cross-origin hoặc một API workflow có thể đọc được |
| CSRF | Attacker có ép trình duyệt đã xác thực của nạn nhân thực hiện hành động ngoài ý muốn không? | Thay đổi trạng thái như đổi email hoặc thực hiện giao dịch |

Một CSRF attempt thường vẫn gửi được request ngay cả khi CORS chặn script đọc response. Vì vậy, CORS sai **không** phải điều kiện cần để có CSRF. Ngược lại, CORS đúng cũng không thay thế được CSRF defense cho endpoint thay đổi trạng thái.

Preflight cũng không phải authorization check. `GET` đơn giản trong lab không cần preflight, nên `Access-Control-Allow-Methods` không phải yếu tố khiến việc đọc thành công. Với request không đơn giản, server vẫn phải xác thực, phân quyền, áp dụng CSRF defense khi phù hợp và xử lý an toàn method thực tế.

## Cách sửa lỗi origin reflection

Không bao giờ dùng giá trị `Origin` trong request làm quyết định allow. Hãy parse nó, đối chiếu với exact allowlist ở phía server, và chỉ trả CORS headers cho origin đã biết:

```js
const allowedOrigins = new Set([
  "https://app.example.com",
]);

function applyCors(response, request) {
  const origin = request.headers.origin;
  if (!origin) return;

  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return; // Từ chối giá trị lỗi và Origin: null.
  }

  if (!allowedOrigins.has(normalizedOrigin)) return;

  response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Vary", "Origin");
}
```

Exact allowlist rất quan trọng. Tránh substring check, suffix check, regex quá rộng và quy tắc “mọi subdomain” trừ khi mọi origin được bao gồm thực sự đáng tin và luôn nằm trong quyền kiểm soát. Nếu response thay đổi theo `Origin`, giữ `Vary: Origin` để shared cache không tái sử dụng response dành cho origin khác.

Đồng thời giảm blast radius:

- Không bật credentialed CORS nếu product flow không thực sự cần.
- Chỉ cho phép method, request header và response header cần thiết cho flow đó.
- Thực thi authentication và object-level authorization trên mọi API request.
- Bảo vệ endpoint thay đổi trạng thái bằng CSRF defense phù hợp; cookie `SameSite` là lớp phòng thủ bổ sung, không thay thế threat model đầy đủ.

## Checklist xác minh

Hãy dùng môi trường được phép và kiểm tra bản sửa từ cả server lẫn trình duyệt:

1. Origin tin cậy chỉ nhận đúng giá trị `Access-Control-Allow-Origin` của chính nó.
2. Origin không tin cậy không nhận CORS allow header—không phải giá trị phản chiếu.
3. `Origin: null` và origin sai định dạng đều bị từ chối.
4. Credentialed flow chỉ thành công từ origin dự kiến và thất bại từ origin khác trong trình duyệt thật.
5. Preflight response chỉ cho phép method và header endpoint thực sự cần.
6. Route thay đổi trạng thái vẫn thực thi CSRF và authorization độc lập với CORS.

## Tài liệu tham khảo

- [WHATWG Fetch Standard: CORS protocol and credentials](https://fetch.spec.whatwg.org/#cors-protocol-and-credentials)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [IETF HTTP State Management Mechanism](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
