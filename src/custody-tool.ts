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

/** Input of the tools that act in one Custody domain (spread into their `input`). */
export const domainInput = {
  domainId: z
    .string()
    .optional()
    .describe("Id of the Custody domain to use (see listDomains). Defaults to the Environment's Default domain."),
}

/**
 * The domain a call acts in: the one it names, else the Environment's Default domain, else the user's
 * only domain (the env-var Environment cannot set a Default domain).
 */
export const domainIdFor = async ({
  input,
  environment,
  custody,
}: {
  input: { domainId?: string }
  environment: Environment
  custody: CustodyClient
}) => {
  const domainId = input.domainId ?? environment.defaultDomainId
  if (domainId !== undefined) {
    return domainId
  }

  const { domains } = await custody.users.me()
  if (domains.length === 1) {
    return domains[0].id
  }
  const listed = domains.map(domain => `${domain.alias} (${domain.id})`).join(', ')
  throw new Error(
    `Environment "${environment.name}" has no Default domain and its user belongs to several domains: ${listed}. Pass a domainId.`,
  )
}

/** Input of the list tools (spread into their `input`). */
export const pageInput = {
  limit: z.number().int().min(1).max(100).default(20).describe('How many items to return (default 20, at most 100).'),
  cursor: z.string().optional().describe('The nextCursor of the previous page, to get the page after it.'),
}

type Page = { nextStartingAfter?: string }

export const pageQuery = ({ limit, cursor }: { limit: number; cursor?: string }) => ({ limit, startingAfter: cursor })

// Omitted on the last page, so the model has no cursor to follow.
export const nextCursor = (page: Page) =>
  page.nextStartingAfter === undefined ? {} : { nextCursor: page.nextStartingAfter }

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

export type DefineCustodyTool = ReturnType<typeof createCustodyToolFactory>
