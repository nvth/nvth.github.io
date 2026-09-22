## The short version

CORS is not an authentication system. It is a browser-enforced protocol that controls which scripted cross-origin requests can proceed and whether JavaScript running on one origin may **read** a response from another origin. It does not replace server-side authentication, authorization, or CSRF defenses: some cross-origin requests, including forms and simple requests, can still reach a server even when their response cannot be read.

That distinction turns an apparently small server-side shortcut into a serious data-exposure bug:

```text
Access-Control-Allow-Origin: <the request Origin>
Access-Control-Allow-Credentials: true
```

If the server reflects any caller-controlled origin and a victim's browser sends relevant credentials, a page controlled by an attacker can read a credentialed API response. The local lab demonstrates exactly that configuration. It should only ever be exercised against systems you own or are explicitly authorized to test.

## First, separate the three browser rules

The most useful way to reason about CORS is to keep these questions separate:

| Question | Controlled by | Example |
| --- | --- | --- |
| Is this cross-origin? | The origin tuple: scheme, host, and port | `http://localhost:8081` and `http://localhost:3000` are different origins because their ports differ. |
| Will a credential travel? | Fetch credentials mode, cookie attributes, browser policy, and the auth mechanism | A cookie with a restrictive `SameSite` policy might not accompany a cross-site fetch. |
| May JavaScript read the response? | The target's CORS response headers | `Access-Control-Allow-Origin` must match the caller's origin; credentialed reads also require `Access-Control-Allow-Credentials: true`. |

The server sees HTTP requests, not a magical trust signal. For a simple CORS request, the browser makes its response-sharing decision after the response arrives; a preflighted request adds an earlier CORS check before the actual request. Command-line clients such as curl and tools such as Burp can send any `Origin` header, so they are excellent for confirming server behavior—but they do not prove that an attacker page can read the response in a browser.

## What the lab proves

The intentionally vulnerable handler takes the request's `Origin` header and returns it as `Access-Control-Allow-Origin`:

```js
function setCorsHeaders(response, request) {
  const origin = request.headers.origin;
  if (!origin) return;

  // Intentionally vulnerable: accepts every caller-controlled origin.
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Vary", "Origin");
}
```

For example, an authenticated request sent to the local lab can produce:

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

The same server also reflects `Origin: null`. That is not a safe fallback: opaque-origin contexts can use that value, so it should be rejected unless a narrowly designed, documented use case requires it.

The raw request proves the flaw: the backend trusts an untrusted input as an allow decision. Supplying the cookie with curl merely simulates an authenticated request; JavaScript cannot attach a `Cookie` header itself.

## When the configuration becomes a data leak

For a browser page to read the lab response, all of these facts must line up:

1. The page runs on an origin the server reflects, such as `http://localhost:8081` in the screenshot.
2. The request uses `credentials: "include"` for a cross-origin cookie-backed request.
3. The browser actually sends a relevant credential under its cookie and browser policy.
4. The response returns the exact caller origin in `Access-Control-Allow-Origin` and the literal, lowercase `true` in `Access-Control-Allow-Credentials`.
5. The API response contains data that the caller should not receive.

The Fetch Standard requires an exact origin match for credentialed CORS. A wildcard (`*`) cannot be used for a response shared with credentials. The lab's reflected value satisfies the exact-match rule for every supplied origin, which is why it is dangerous.

The screenshot uses two ports on `localhost`. They are cross-origin, yet they can be treated as same-site for cookie policy. Do not generalize that local result to a remote domain: an attacker at `https://attacker.example` normally needs the target browser to send credentials across sites, for example because of a deliberately cross-site cookie policy, another applicable browser credential, or control of a same-site origin. Test that condition in a real browser for the deployment being assessed.

## A browser proof of concept in the lab

After starting the lab at `http://localhost:3000`, serve a harmless page you control at `http://localhost:8081`. Visit the lab first so its demo cookie exists, then run this code from the page at port 8081:

```js
(async () => {
  const response = await fetch("http://localhost:3000/api/account", {
    credentials: "include",
  });

  console.log("HTTP status:", response.status);
  console.log(await response.text());
})().catch(console.error);
```

If the browser has sent the lab cookie, the origin has been reflected, and the CORS check succeeds, the console can display the JSON response.

![Browser proof of concept against the local CORS lab](/blogs/cors-truth/acao-arbitrary.png)

This is the key impact: CORS does not grant the attacker a new identity. It lets attacker-controlled JavaScript read data that the victim's browser was already authorized to request.

## CORS is not CSRF

CORS and CSRF often appear in the same finding, but they solve different problems.

| Topic | Main question | Typical consequence |
| --- | --- | --- |
| CORS | Can this origin's JavaScript read the response? | Cross-origin data disclosure or a readable API workflow |
| CSRF | Can an attacker make a victim's authenticated browser perform an unwanted action? | State changes such as changing an email address or submitting a transfer |

A CSRF attempt can often send a request even when CORS blocks its script from reading the response. Therefore, a bad CORS policy is **not** a prerequisite for CSRF. Conversely, correct CORS headers do not replace CSRF defenses on state-changing endpoints.

Preflight is also not an authorization check. A simple `GET` in this lab needs no preflight, so `Access-Control-Allow-Methods` is not what makes the read possible. For non-simple requests, the server must still authenticate, authorize, validate CSRF protections where relevant, and handle the actual method safely.

## How to fix origin reflection

Never use the request's `Origin` value as the allow decision. Parse it, compare it to an exact server-side allowlist, and return CORS headers only for a known origin:

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
    return; // Reject malformed values and Origin: null.
  }

  if (!allowedOrigins.has(normalizedOrigin)) return;

  response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Vary", "Origin");
}
```

The exact allowlist matters. Avoid substring checks, suffix checks, broad regular expressions, and “all subdomains” rules unless every included origin is genuinely trusted and continuously controlled. If responses vary by `Origin`, keep `Vary: Origin` so shared caches do not reuse a response intended for another origin.

Also reduce the blast radius:

- Do not enable credentialed CORS unless a real product flow needs it.
- Limit methods, request headers, and exposed response headers to the minimum for that flow.
- Enforce authentication and object-level authorization on every API request.
- Protect state-changing endpoints with appropriate CSRF defenses; cookie `SameSite` is useful defense in depth, not a substitute for a full threat model.

## Verification checklist

Use an authorized environment and verify the fix from both the server and a browser:

1. A trusted origin receives exactly its own `Access-Control-Allow-Origin` value.
2. An untrusted origin receives no CORS allow header—not a reflected value.
3. `Origin: null` and malformed origins are rejected.
4. Credentialed flows succeed only from intended origins and fail from others in a real browser.
5. Preflight responses permit only the methods and headers the endpoint truly needs.
6. State-changing routes still enforce CSRF and authorization controls independently of CORS.

## References

- [WHATWG Fetch Standard: CORS protocol and credentials](https://fetch.spec.whatwg.org/#cors-protocol-and-credentials)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [IETF HTTP State Management Mechanism](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
