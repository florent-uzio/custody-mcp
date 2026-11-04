import { createTool } from '@mastra/core/tools'
import { MCPServer } from '@mastra/mcp'
import { z } from 'zod'
import packageJson from '../package.json'
import { connectCustody, type ConnectCustody } from './custody'
import { createAccountTools } from './account-tools'
import { createDecryptionTools } from './decryption-tools'
import { createApproveTools } from './approve-tools'
import { createCustodyToolFactory } from './custody-tool'
import { createIntentTools } from './intent-tools'
import { loadEnvironments } from './environments'
import { CUSTODY_INSTRUCTIONS } from './instructions'
import { createProposeTools } from './propose-tools'
import { createReferenceTools } from './reference-tools'
import { createTransactionTools } from './transaction-tools'

export type ServerOptions = {
  env: Record<string, string | undefined>
  connect?: ConnectCustody
}

export const createCustodyMcpServer = (options: ServerOptions) => {
  // MCP clients do not hand the server version to the model: a tool is the only way to ask for it.
  const getMcpVersion = createTool({
    id: 'getMcpVersion',
    description: 'Get the version of this Ripple Custody MCP server (the @florent-uzio/custody-mcp npm package).',
    inputSchema: z.object({}),
    outputSchema: z.object({ name: z.string(), version: z.string() }),
    execute: async () => ({ name: packageJson.name, version: packageJson.version }),
  })

  const listEnvironments = createTool({
    id: 'listEnvironments',
    description:
      'List the Environments (Ripple Custody instances with your credentials) this server can use, with their Access level and which one is the default.',
    inputSchema: z.object({}),
    // Read on every call, so a bad setting fails one tool call instead of stopping the server.
    execute: async () => {
      const { environments, defaultName } = await loadEnvironments(options.env)
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
  })

  const defineCustodyTool = createCustodyToolFactory(options.env, options.connect ?? connectCustody)

  const getMe = defineCustodyTool({
    id: 'getMe',
    description:
      'Get the Custody user this Environment acts as: its public key and, for each domain it belongs to, the user id, alias and roles.',
    input: {},
    run: async ({ custody }) => ({ me: await custody.users.me() }),
  })

  const getBackendVersion = defineCustodyTool({
    id: 'getBackendVersion',
    description:
      'Get the version of the Ripple Custody instance behind this Environment, to tell an MCP problem from a backend one.',
    input: {},
    run: async ({ custody }) => ({ backendVersion: await custody.backendVersion() }),
  })

  return new MCPServer({
    id: 'custody-mcp',
    name: 'Ripple Custody',
    version: packageJson.version,
    description: 'Read from and act on Ripple Custody instances as your own Custody user',
    instructions: CUSTODY_INSTRUCTIONS,
    tools: {
      getMcpVersion,
      getBackendVersion,
      listEnvironments,
      getMe,
      ...createAccountTools(defineCustodyTool),
      ...createDecryptionTools(defineCustodyTool),
      ...createIntentTools(defineCustodyTool),
      ...createProposeTools(defineCustodyTool),
      ...createApproveTools(defineCustodyTool),
      ...createTransactionTools(defineCustodyTool),
      ...createReferenceTools(defineCustodyTool),
    },
  })
}
