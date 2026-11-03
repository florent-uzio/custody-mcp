// Seam 1 test support: a real config file in a temp dir, a fake Custody client, tools called by name.
import { mkdtempSync, writeFileSync } from 'node:fs'
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
