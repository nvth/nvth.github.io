# Install BurpMCP-Ultra with Codex on Windows

This guide connects Burp Suite Professional to Codex manually, without CC-switch. BurpMCP-Ultra exposes Burp tools through MCP, while `mcp-remote` bridges Codex's local STDIO connection to the extension's SSE endpoint.

## Requirements

| Component | Purpose |
| --- | --- |
| Burp Suite Professional | Capture traffic and perform authorized testing |
| BurpMCP-Ultra | Expose Burp capabilities through MCP |
| Node.js LTS with npm/npx | Run the `mcp-remote` bridge |
| Codex desktop or Codex CLI | Connect to and operate the MCP tools |

Connection flow:

```text
Codex → mcp-remote (STDIO → SSE) → BurpMCP-Ultra → Burp Suite
```

This setup does not require CC-switch, Caddy, or PortSwigger's `mcp-proxy.jar`.

## Step 1: Install Node.js and Codex

Download the Windows LTS release from [Node.js](https://nodejs.org/). Keep npm and the option to add Node.js to PATH enabled during installation. Open a new PowerShell window and verify:

```powershell
node --version
npm.cmd --version
npx.cmd --version
where.exe npx.cmd
```

Each version command should print a version number. The last command shows the path to `npx.cmd`.

If you already use Codex desktop, you can continue to the next step. To install Codex CLI:

```powershell
npm.cmd install -g @openai/codex
codex --version
codex
```

Complete sign-in when prompted.

## Step 2: Install BurpMCP-Ultra

1. Open the [BurpMCP-Ultra Releases page](https://github.com/Cy-S3c/BurpMCP-Ultra/releases).
2. Download the extension `.jar` from Assets. Do not download the source-code ZIP.
3. In Burp, open **Extensions → Installed → Add**.
4. Select **Java**, choose the downloaded JAR, and finish loading the extension.
5. Open **BurpMCP-Ultra → Server** and confirm that its status is **Running**.

The default endpoint is:

```text
http://127.0.0.1:9876/
```

Keep the trailing `/` and do not append `/sse`. If another Burp MCP extension already occupies port 9876, stop it or change Ultra's port and update the Codex configuration below.

## Step 3: Get the Bearer token

1. Open the **BurpMCP-Ultra** tab in Burp Suite.
2. Select **Server** and confirm that the server is running.
3. Find the connection token and copy its complete value.
4. Add `Bearer ` before the token when setting `AUTH_HEADER`.

For example, if the displayed token is `abc123`, use:

```toml
[mcp_servers.burp_ultra.env]
AUTH_HEADER = "Bearer abc123"
```

There is exactly one space between `Bearer` and the token. If the copied value already begins with `Bearer `, do not add it again. The resulting HTTP header is:

```http
Authorization: Bearer abc123
```

This is BurpMCP-Ultra's connection token. It is not an OpenAI API key or a session token from the website being tested. Do not commit the real token to GitHub or expose it in logs and screenshots.

## Step 4: Configure Codex

Open the Codex configuration file:

```text
C:\Users\YOUR_USERNAME\.codex\config.toml
```

You can open the default location from PowerShell:

```powershell
notepad "$env:USERPROFILE\.codex\config.toml"
```

Keep the rest of the file intact. If a `burp_ultra` section already exists, update it instead of creating a duplicate.

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
AUTH_HEADER = "Bearer REPLACE_WITH_THE_TOKEN_FROM_BURP"
```

`cmd.exe` starts `npx.cmd` reliably on Windows. The `--transport sse-only` option is required because Ultra serves MCP over SSE. Without it, `mcp-remote` tries Streamable HTTP first and may stop after Ultra returns a `sessionId query parameter is not provided` error.

## Step 5: Start and verify

1. Keep Burp open and BurpMCP-Ultra running.
2. Fully exit and restart Codex so it reloads `config.toml`.
3. In Codex CLI, enter `/mcp` and find `burp_ultra`.
4. Ask Codex:

> Use burp_ultra to read the Burp version and extension information. Only verify the connection; do not send requests to any website.

The connection is verified when Codex calls a Burp tool and receives actual data. Seeing the server name in `/mcp` alone is not a complete end-to-end check.

You do not need to keep a separate PowerShell window running `mcp-remote`. Codex starts and manages the bridge from its configuration. The first run requires internet access so npx can download the package.

## Manual connection test

If Codex cannot initialize the server, run this in PowerShell with the real token:

```powershell
$env:AUTH_HEADER = 'Bearer REPLACE_WITH_THE_TOKEN_FROM_BURP'
npx.cmd -y mcp-remote 'http://127.0.0.1:9876/' --allow-http --transport sse-only --header 'Authorization:${AUTH_HEADER}'
```

Read the log, then press **Ctrl+C** when the diagnostic test is complete. Copy commands only from the code block: the URL must remain the plain string `http://127.0.0.1:9876/`, and the variable name is `AUTH_HEADER` without a backslash.

## Common problems

| Error or symptom | Fix |
| --- | --- |
| `program not found` | Verify `npx.cmd` and PATH, then restart Codex |
| `npx.cmd` is not recognized | Run `where.exe npx.cmd` and verify that Node.js is on PATH |
| `sessionId query parameter is not provided` | Add `--transport sse-only`; do not create a sessionId manually |
| `401 Unauthorized` | Copy the current token again and verify `Bearer ` plus one space |
| `Connection refused` | Confirm Ultra is running and the host and port are correct |
| `connection closed: initialize response` | Run the manual test and inspect the earlier, more specific error |
| Startup timeout | Check connectivity, pre-download mcp-remote, and keep the timeout at 120 seconds |
| Connected but history is empty | Send browser traffic through Burp and inspect Proxy → HTTP history |

## Start using BurpMCP-Ultra

Add the authorized target to Burp Scope and set Ultra's scope mode to `enforce`. Browse the application through Burp to populate HTTP history, then begin with passive analysis:

> Read HTTP history within scope. Summarize endpoints, methods, parameters, and authentication. Analyze captured data only and redact tokens from the output.

Continue with a focused request:

> From the captured traffic, identify items that need verification and cite the supporting requests. Separate hypotheses from confirmed findings.

For active testing, always specify the allowed endpoint, permitted operations, and a request limit. Keep Burp open for the entire session.

## References

- [BurpMCP-Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra)
- [mcp-remote](https://github.com/punkpeye/mcp-remote)
- [Codex MCP documentation](https://developers.openai.com/codex/mcp)
- [MCP Server for Codex on Windows](https://github.com/nvth/mcp-server-codex-for-windows)
