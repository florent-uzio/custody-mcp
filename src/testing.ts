// Seam 1 test support: a real config file in a temp dir, a fake Custody client, tools called by name.
import { MCPClient } from '@mastra/mcp'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CustodyClient } from './custody'
import { createCustodyMcpServer, type ServerOptions } from './server'

/** A real config file in a fresh temp dir; returns its path, or a path with no file when given nothing. */
export const configFile = (config?: object) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'custody-mcp-')), 'config.json')
  if (config !== undefined) {
    writeFileSync(file, JSON.stringify(config))
  }
  return file
}

// Keeps tests away from the developer's own config file.
export const NO_CONFIG = configFile()

export const ENV_VARS = {
  CUSTODY_MCP_CONFIG: NO_CONFIG,
  AUTH_URL: 'https://auth.example.test/token',
  API_URL: 'https://api.example.test',
  PUBLIC_KEY: 'MCowBQYDK2VwAyEAPUBLICKEYPUBLICKEYPUBLICKEYPUBLICKEYPU=',
  PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nSECRETSECRETSECRET\n-----END PRIVATE KEY-----',
}

export const DEV = {
  authUrl: 'https://auth.dev.test/token',
  apiUrl: 'https://api.dev.test',
  publicKey: 'MCowBQYDK2VwAyEADEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEV=',
}

/** Stands in for custody.js: only the namespaces a test needs, with canned answers. */
export const fakeCustody = (namespaces: object) => namespaces as CustodyClient

export const callTool = async (options: ServerOptions, toolId: string, args: object = {}) => {
  try {
    const result = await createCustodyMcpServer(options).executeTool(toolId, args)
    return (result as { output?: unknown }).output
  } catch (error) {
    return { error: (error as Error).message }
  }
}

type InputRequests = NonNullable<ConstructorParameters<typeof MCPClient>[0]['servers'][string]['inputRequests']>

/**
 * Seam 1 over the real protocol: the server on a local HTTP port and a client that answers its input
 * requests with `elicit`, as a human would. Without `elicit` the client declares no elicitation support.
 */
export const callToolOverMcp = async (options: ServerOptions, toolId: string, args: object, elicit?: InputRequests) => {
  const server = createCustodyMcpServer(options)
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    void server.startHTTP({ url, httpPath: '/mcp', req, res })
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  const client = new MCPClient({
    servers: {
      custody: {
        url: new URL(`http://127.0.0.1:${port}/mcp`),
        onToolError: 'return',
        ...(elicit === undefined ? {} : { inputRequests: elicit }),
      },
    },
  })
  try {
    const tools = await client.listTools()
    // The client unwraps a plain result, but hands back the raw MCP result of a failed call or of one
    // that went through an input request.
    const result = (await tools[`custody_${toolId}`].execute!(args, {})) as {
      isError?: boolean
      content?: { text: string }[]
    }
    if (!Array.isArray(result.content)) {
      return result
    }
    const text = result.content.map(item => item.text).join('\n')
    return result.isError === true ? { error: text } : JSON.parse(text)
  } finally {
    await client.disconnect()
    await new Promise(resolve => http.close(resolve))
  }
}
