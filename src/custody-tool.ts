import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { ConnectCustody, CustodyClient } from './custody'
import { loadEnvironments, type Environment } from './environments'
import { resolveKeyReference } from './key-references'

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
  // One client per Environment keeps its auth token across calls. The key is only read when a client
  // is made, and the client is remade when the Environment's settings change in the config file.
  const clients = new Map<string, { settings: string; custody: CustodyClient }>()

  const resolve = async (name: string | undefined) => {
    const { environments, defaultName } = await loadEnvironments(env)

    const wanted = name ?? defaultName
    const environment = environments.find(item => item.name === wanted)
    if (!environment) {
      const known = environments.map(item => item.name).join(', ')
      throw new Error(`Unknown Environment "${wanted}". Known Environments: ${known}.`)
    }

    const settings = JSON.stringify([
      environment.authUrl,
      environment.apiUrl,
      environment.publicKey,
      environment.keyReference,
    ])
    let cached = clients.get(environment.name)
    if (cached?.settings !== settings) {
      const privateKey = await resolveKeyReference(environment.keyReference, env).catch((error: Error) => {
        throw new Error(
          `Cannot read the private key of Environment "${environment.name}" from ${environment.keyReference}: ${error.message}`,
        )
      })
      cached = { settings, custody: connect({ ...environment, privateKey }) }
      clients.set(environment.name, cached)
    }
    return { environment, custody: cached.custody }
  }

  return <Shape extends z.ZodRawShape, Result extends object>(spec: CustodyToolSpec<Shape, Result>) =>
    createTool({
      id: spec.id,
      description: spec.description,
      inputSchema: z.object({ ...environmentInput, ...spec.input }),
      execute: async inputData => {
        // Generic shapes defeat zod's inference here; the schema above has already validated the input.
        const { environment: name, ...input } = inputData as { environment?: string } & Record<string, unknown>
        const { environment, custody } = await resolve(name)
        try {
          const result = await spec.run({ input: input as z.infer<z.ZodObject<Shape>>, custody, environment })
          return { environment: environment.name, ...result }
        } catch (error) {
          throw error instanceof Error ? error : new Error(JSON.stringify(error) ?? String(error))
        }
      },
    })
}
