---
title: Caido Go SDK
tags:
  - caido
  - go
  - sdk
  - graphql
aliases:
  - "/Brain-Sharing/MCP-Setup/Caido-SDK-Go"
---
Community Go SDK for the Caido web proxy. Type-safe GraphQL client with domain-specific packages for requests, intercept, replay, findings, scopes, and more. Powers the Caido MCP server.

Source: [caido-community/sdk-go](https://github.com/caido-community/sdk-go)

## Architecture

```
Your Go Code  -->  sdk-go  -->  GraphQL (genqlient)  -->  Caido Instance (port 8080)
```

Built on [Khan/genqlient](https://github.com/Khan/genqlient) for compile-time type safety. Every GraphQL query/mutation has a corresponding Go function with typed inputs and outputs.

## Install

```bash
go get github.com/caido-community/sdk-go
```

## Auth

Two options, same as the MCP server:

**Personal Access Token:**
```go
client, err := caido.NewClient("http://localhost:8080", caido.WithPAT("your-token"))
```

**OAuth device flow:**
```go
client, err := caido.NewClient("http://localhost:8080", caido.WithOAuth())
```

## Domain Packages

The SDK is organized by Caido feature area:

| Package | What it covers |
|---------|---------------|
| `requests` | Proxy history -- list, get, filter with HTTPQL |
| `intercept` | Intercept queue -- list, forward, drop, toggle |
| `replay` | Replay sessions -- list sessions, get entries, send |
| `findings` | Security findings -- create, list, delete, export |
| `scopes` | Target scopes -- list, create |
| `projects` | Project management -- list, select |
| `environments` | Environment variables -- list, select |
| `workflows` | Workflow automation -- list, run, toggle |
| `tasks` | Background tasks -- list, cancel |
| `filters` | Saved filter presets -- list |
| `users` | User/auth info |
| `plugins` | Plugin management |

## Usage

```go
package main

import (
    "context"
    "fmt"

    "github.com/caido-community/sdk-go"
)

func main() {
    client, err := caido.NewClient(
        "http://localhost:8080",
        caido.WithPAT("your-token"),
    )
    if err != nil {
        panic(err)
    }

    // List recent proxy requests filtered by host
    requests, err := client.Requests.List(context.Background(), &sdk.RequestFilter{
        HTTPQL: `req.host.eq:"target.com"`,
    })
    if err != nil {
        panic(err)
    }

    for _, r := range requests {
        fmt.Printf("%s %s -> %d\n", r.Method, r.Path, r.Response.StatusCode)
    }
}
```

## HTTPQL

Caido's query language for filtering requests:

```
req.host.eq:"example.com"
req.method.eq:"POST"
req.path.cont:"/api/"
resp.code.gte:400
resp.body.cont:"error"
```

Operators: `eq`, `neq`, `cont`, `ncont`, `gte`, `lte`, `gt`, `lt`. Combine with `AND` / `OR`.

## Relationship to MCP Server

The [Caido MCP Server](/brain-sharing/mcp-setup/caido-mcp-setup/) is the primary consumer of this SDK. If you're building custom Go tooling against Caido (scripts, integrations, CI pipelines), use the SDK directly. If you want AI assistant access, use the MCP server which wraps the SDK with tool definitions and credential management.

| Use case | Use |
|----------|-----|
| AI assistant integration | Caido MCP Server |
| Custom Go scripts/tools | sdk-go directly |
| One-off proxy queries | Caido CLI (built on sdk-go) |
