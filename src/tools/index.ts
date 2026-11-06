import type { ToolsInput } from '@mastra/core/agent'
import type { ConnectCustody } from '../custody'
import { createAccountTools } from './accounts'
import { createApproveTools } from './approve'
import { createBatchTools } from './batch'
import { createDecryptionTools } from './decryption'
import { createCustodyToolFactory } from './define'
import { createIntentTools } from './intents'
import { createProposeTools } from './propose'
import { createReferenceTools } from './reference'
import { createServerInfoTools } from './server-info'
import { createTransactionTools } from './transactions'

/** Merges tool groups into one, so two tools with the same id fail loudly instead of one replacing the other. */
export const mergeTools = (groups: ToolsInput[]) => {
  const tools: ToolsInput = {}
  for (const group of groups) {
    for (const [id, tool] of Object.entries(group)) {
      if (id in tools) {
        throw new Error(`Duplicate tool id: ${id}`)
      }
      tools[id] = tool
    }
  }
  return tools
}

/** Every tool this server registers: the one place to see them all. */
export const createTools = (env: Record<string, string | undefined>, connect: ConnectCustody) => {
  const defineCustodyTool = createCustodyToolFactory(env, connect)
  return mergeTools([
    createServerInfoTools(env, defineCustodyTool),
    createAccountTools(defineCustodyTool),
    createDecryptionTools(defineCustodyTool),
    createIntentTools(defineCustodyTool),
    createProposeTools(defineCustodyTool),
    createBatchTools(defineCustodyTool),
    createApproveTools(defineCustodyTool),
    createTransactionTools(defineCustodyTool),
    createReferenceTools(defineCustodyTool),
  ])
}
