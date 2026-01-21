
# Setting Up Claude MCP with Burp Suite (Without Claude Desktop)

## What is MCP?

- Model Context Protocol (MCP) is a open framework which allows AI models talking time-synchronously with other tools and data resources. 
- MCP is a bridge to enable AI assistants to engage more productively with corporate tools, dev environments and structured knowledge. 
- Rather than merely being disjointed integrations, MCP achieves a joined-up system, enabling AI tools to be more flexible, responsive and practical in technical workflow.

### References & Documentation

- For anyone hoping to build or know the study of the MCP here are some nice resources:
    - Anthropic’s official announcement: [MCP is here!](https://www.anthropic.com/news/model-context-protocol)
    - MCP Technical Docs: [Docs](https://modelcontextprotocol.io/docs/getting-started/intro)
    - Guide & Overview: [Guide](https://modelcontextprotocol.io/docs/getting-started/intro)

## What is This?

- This setup allows Claude to directly interact with Burp Suite - reading proxy history, sending requests, creating Repeater tabs, and more. All from your terminal, without needing Claude Desktop.

### Stack
- Claude Code - Anthropic's official CLI tool
- Burp Suite - Professional/Community edition
- Burp MCP Server - Extension that exposes Burp functionality via MCP protocol

## Prerequisites

- https://docs.anthropic.com/en/docs/claude-code installed and authenticated
- Burp Suite (Professional or Community)
- The Burp MCP Server extension (BApp Store or manual install)

### Step 1. Install the MCP Extension in Burp

- For this guide obviously you need to have setup BurpSuite in your operating system. 
- You can watch any youtube tutorial as installing burp suite is fairly simple in any operating system, download and run the installer.

- Launch Burp Suite and navigate to the `Extensions` section. 
- Search for the MCP server plugin and hit Install to get started. 

### Step 2: Configure Claude Code

- Create or edit your Claude Code MCP configuration. 
- You have two options:
	- Option A: User-Level Configuration (Recommended)
	- Edit ~/.claude/settings.json:

  ```json
  {
    "mcpServers": {
      "burp": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-proxy", "http://localhost:9876/mcp"]
      }
    }
  }
  ```

	- Option B: Project-Level Configuration
	- Create .mcp.json in your project directory:

```json
{
    "mcpServers": {
      "burp": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-proxy", "http://localhost:9876/mcp"]
      }
    }
  }
```
  
**Note**: If using project-level config, Claude Code will show "file does not exist" if .mcp.json is missing - this is fine if you're using user-level config instead.

### Step 3: Verify the Connection

  1. Start Burp Suite (ensure the MCP Server extension is loaded)
  2. Open a terminal and run: `claude`
  3. Type /mcp to see connected servers
  4. You should see:
  burp ✓ connected

### Step 4: Test It Out

- Ask Claude to fetch proxy history: `can you check my burp proxy history?`
- Claude will use the MCP tools to query Burp and return captured requests.

### Example Workflow

  > You: Check my proxy history for any requests to example.com

  Claude: [Queries Burp MCP] Found 3 requests to example.com...

  > You: Send that login request to Repeater

  Claude: [Creates Repeater tab with the request]

  > You: Can you test for SQL injection in the username parameter?

  Claude: [Sends modified requests, analyzes responses]

### Troubleshooting
- `"File does not exist"` warning
	- Normal if using user-level config instead of project-level
- `Burp shows "connecting..."`
	- EnsureBurp is running and MCP Server extension is loaded
- `Connection refused`
	- Check the port (default 9876) matches your extension config
- `No tools available`
	- Restart Claude Code after adding MCP configuration

### Why This Matters

  - **No Claude Desktop required** - works directly in your terminal
  - **Full Burp integration** - Claude can read, send, and analyze requests
  - **Pentesting assistant** - automated analysis, payload suggestions, and more
  - **CTF helper** - quickly analyze challenges with AI assistance

  Credits

  - https://claude.ai/claude-code
  - https://portswigger.net/burp

  Happy hacking! 🔐


