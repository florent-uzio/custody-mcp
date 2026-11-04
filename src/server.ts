import { MCPServer } from '@mastra/mcp'
import packageJson from '../package.json'
import { connectCustody, type ConnectCustody } from './custody'
import { createTools } from './tools'
import { CUSTODY_INSTRUCTIONS } from './tools/instructions'

export type ServerOptions = {
  env: Record<string, string | undefined>
  connect?: ConnectCustody
}

export const createCustodyMcpServer = (options: ServerOptions) =>
  new MCPServer({
    id: 'custody-mcp',
    name: 'Ripple Custody',
    version: packageJson.version,
    description: 'Read from and act on Ripple Custody instances as your own Custody user',
    instructions: CUSTODY_INSTRUCTIONS,
    tools: createTools(options.env, options.connect ?? connectCustody),
  })
