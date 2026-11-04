import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import packageJson from '../../package.json'
import { loadEnvironments } from '../environments'
import type { DefineCustodyTool } from './define'

/** The tools about this server and its Environments, rather than about Custody data. */
export const createServerInfoTools = (
  env: Record<string, string | undefined>,
  defineCustodyTool: DefineCustodyTool,
) => ({
  // MCP clients do not hand the server version to the model: a tool is the only way to ask for it.
  getMcpVersion: createTool({
    id: 'getMcpVersion',
    description: 'Get the version of this Ripple Custody MCP server (the @florent-uzio/custody-mcp npm package).',
    inputSchema: z.object({}),
    outputSchema: z.object({ name: z.string(), version: z.string() }),
    execute: async () => ({ name: packageJson.name, version: packageJson.version }),
  }),

  getBackendVersion: defineCustodyTool({
    id: 'getBackendVersion',
    description:
      'Get the version of the Ripple Custody instance behind this Environment, to tell an MCP problem from a backend one.',
    input: {},
    run: async ({ custody }) => ({ backendVersion: await custody.backendVersion() }),
  }),

  listEnvironments: createTool({
    id: 'listEnvironments',
    description:
      'List the Environments (Ripple Custody instances with your credentials) this server can use, with their Access level and which one is the default.',
    inputSchema: z.object({}),
    // Read on every call, so a bad setting fails one tool call instead of stopping the server.
    execute: async () => {
      const { environments, defaultName } = await loadEnvironments(env)
      return {
        // Picked field by field: key material must never reach the conversation.
        environments: environments.map(environment => ({
          name: environment.name,
          authUrl: environment.authUrl,
          apiUrl: environment.apiUrl,
          access: environment.access,
          defaultDomainId: environment.defaultDomainId,
          xrplNodes: environment.xrplNodes,
          isDefault: environment.name === defaultName,
        })),
      }
    },
  }),
})
