import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { ConnectCustody, CustodyClient } from './custody'
import { environmentsFromEnv, type Environment } from './environments'

const environmentInput = {
  environment: z
    .string()
    .optional()
    .describe('Name of the Environment to use (see listEnvironments). Defaults to the default Environment.'),
}

type CustodyToolSpec<Shape extends z.ZodRawShape, Result extends object> = {
  id: string
  description: string
  input: Shape
  run: (args: {
    input: z.infer<z.ZodObject<Shape>>
    custody: CustodyClient
    environment: Environment
  }) => Promise<Result>
}

/**
 * Builds the tools that talk to Custody. Every such tool goes through here, so they all resolve the
 * Environment the same way, reuse one client per Environment, name the Environment in their result
 * and turn any thrown value into a readable error.
 */
export const createCustodyToolFactory = (env: Record<string, string | undefined>, connect: ConnectCustody) => {
  // One client per Environment keeps its auth token across calls.
  const clients = new Map<string, CustodyClient>()

  const resolve = (name: string | undefined) => {
    const environments = environmentsFromEnv(env)
    if (environments.length === 0) {
      throw new Error('No Environment configured. Run `npx @florent-uzio/custody-mcp add-env <name>` to set one up.')
    }

    const environment = name === undefined ? environments[0] : environments.find(item => item.name === name)
    if (!environment) {
      const known = environments.map(item => item.name).join(', ')
      throw new Error(`Unknown Environment "${name}". Known Environments: ${known}.`)
    }

    let custody = clients.get(environment.name)
    if (!custody) {
      custody = connect(environment)
      clients.set(environment.name, custody)
    }
    return { environment, custody }
  }

  return <Shape extends z.ZodRawShape, Result extends object>(spec: CustodyToolSpec<Shape, Result>) =>
    createTool({
      id: spec.id,
      description: spec.description,
      inputSchema: z.object({ ...environmentInput, ...spec.input }),
      execute: async inputData => {
        // Generic shapes defeat zod's inference here; the schema above has already validated the input.
        const { environment: name, ...input } = inputData as { environment?: string } & Record<string, unknown>
        const { environment, custody } = resolve(name)
        try {
          const result = await spec.run({ input: input as z.infer<z.ZodObject<Shape>>, custody, environment })
          return { environment: environment.name, ...result }
        } catch (error) {
          throw error instanceof Error ? error : new Error(JSON.stringify(error) ?? String(error))
        }
      },
    })
}
