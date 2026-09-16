## The connection problem

Burp Suite is excellent at retaining HTTP history, while Codex CLI can help read and analyze that history. The difficult part is the bridge between them. The `mcp-server-codex-for-windows-main` repository documents a Windows setup using PortSwigger's MCP Server, a Java proxy, and a Caddy reverse proxy.

The complete flow is:

```text
Browser → Burp Suite → MCP Server → Caddy → Codex CLI
```

Codex does not need to send requests directly in this flow. It reads data recorded by Burp through MCP, so you can begin with passive analysis.

> Use this setup only with labs, systems you own, or targets for which you have explicit testing permission.

## Prerequisites

| Component | Purpose |
| --- | --- |
| Burp Suite Professional | Capture and display browser traffic |
| MCP Server extension | Expose an MCP endpoint from Burp |
| Codex CLI | Send analysis requests to Codex |
| Caddy | Reverse proxy for the MCP endpoint |
| Java 17 or newer | Run `mcp-proxy.jar` |
| Node.js | Install Codex CLI through npm |

## 1. Install Codex CLI

Install Node.js from the [official download page](https://nodejs.org/en/download/current), then open a new Command Prompt and run:

```cmd
npm install -g @openai/codex
codex --version
```

If the first command fails because of permissions, install Node.js for the current user or use an Administrator window according to your machine policy. You only need a version number before moving on to MCP.

## 2. Install MCP Server in Burp

Open Burp Suite Professional, go to **BApp Store**, search for `MCP`, and install **MCP Server**. In the **MCP** tab, choose **Extract server proxy jar** to create `mcp-proxy.jar`.

Record the real path to the JAR. You will use it in `config.toml`; do not leave the sample path in place.

By default, Burp's MCP Server listens on:

```text
127.0.0.1:9876
```

## 3. Configure Codex

Open:

```text
C:\Users\YOUR_USERNAME\.codex\config.toml
```

Add the following configuration and replace `C:\PATH\TO\mcp-proxy.jar` with the real path:

```toml
[mcp_servers.burp]
command = "java"
args = ["-jar", "C:\\PATH\\TO\\mcp-proxy.jar", "--sse-url", "http://127.0.0.1:19876"]
```

In TOML, Windows backslashes must be escaped as `\\`. Keep other existing entries in the file.

## 4. Create the Caddy reverse proxy

Install Caddy for Windows, put `caddy.exe` in a directory on `PATH`, and create a file named `Caddyfile`:

```caddyfile
:19876

reverse_proxy 127.0.0.1:9876 {
    header_up Host "127.0.0.1:9876"
    header_up Origin "http://127.0.0.1:9876"
    header_up -User-Agent
    header_up -Accept
    header_up -Accept-Encoding
    header_up -Connection
}
```

Caddy accepts connections on port `19876` and forwards them to MCP Server on `9876`. That is why Codex's `--sse-url` must use `http://127.0.0.1:19876`, not Burp's backend endpoint.

Run Caddy from the directory containing `Caddyfile`:

```cmd
caddy run --config Caddyfile
```

When running from another directory, pass the full path to the configuration file.

## 5. Enable MCP and verify the path

Return to Burp's **MCP** tab and enable MCP Server. Open another Command Prompt, run `codex`, then use:

```text
/mcp
```

If you see a server named `burp`, Codex has loaded the configuration. The first check should only verify connectivity:

> Read the HTTP history in Burp and report the available methods and hosts. Do not send new requests.

Seeing a server name in the list is not enough. Ask Codex to call a tool and return real Burp data to verify the complete path.

## 6. Analyze traffic with clear limits

Open a browser configured to proxy through Burp and visit an authorized lab. Once traffic appears under **Proxy → HTTP history**, ask:

```text
Read the HTTP history in Burp and identify the highest-risk findings.
Separate confirmed evidence from hypotheses and do not send new requests.
```

A controlled workflow starts by reading history, summarizing endpoints/methods/parameters, and deciding whether active testing is necessary. If new requests are allowed, specify the endpoint, request limit, and authorized scope.

## 7. Common problems

| Symptom | Check |
| --- | --- |
| `burp` is missing from `/mcp` | MCP Server is enabled, Caddy is running, and the JAR path is correct |
| Caddy cannot find `Caddyfile` | Run in the correct directory or use the full path |
| Codex cannot read data | The browser is going through Burp and HTTP history has new traffic |
| Java cannot run the JAR | Check `java -version` and use Java 17 or newer |
| Connection fails | Confirm Burp is on `9876` and Caddy is on `19876` |

When sharing logs, redact tokens, cookies, Authorization headers, and sensitive data. Do not commit a personal configuration file containing credentials.

## MCP Server versus BurpMCP-Ultra

This article uses PortSwigger MCP Server, `mcp-proxy.jar`, and Caddy. If you use BurpMCP-Ultra with `mcp-remote` and a Bearer token, read the [BurpMCP-Ultra with Codex on Windows guide](/blogs/burpmcp-ultra-codex-windows/); it is a different setup and does not require Caddy.

## Closing note

The Java proxy + Caddy model is a clear way to connect Burp MCP to Codex CLI on Windows. Remember the `9876 → 19876` port pair, use the real JAR path in TOML, and begin with passive HTTP history analysis inside an authorized scope.
