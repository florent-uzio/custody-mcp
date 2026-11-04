import { createTool, type ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import type { ConnectCustody, CustodyClient } from '../custody'
import { createExplorerLinks, type ExplorerLinks } from './explorer-links'
import { ACCESS_LEVELS, loadEnvironments, type AccessLevel, type Environment } from '../environments'
import { resolveKeyReference } from '../key-references'

const environmentInput = {
  environment: z
    .string()
    .optional()
    .describe('Name of the Environment to use (see listEnvironments). Defaults to the default Environment.'),
}

// A write never falls back to the default Environment, so a changed default cannot redirect it (ADR-0001).
const writeEnvironmentInput = {
  environment: z
    .string()
    .describe('Name of the Environment to act in (see listEnvironments). Required: writes never use the default.'),
}

// Added to the input of the tools that act in one Custody domain (`domain: true`).
const domainInput = {
  domainId: z
    .string()
    .optional()
    .describe("Id of the Custody domain to use (see listDomains). Defaults to the Environment's Default domain."),
}

/**
 * The domain a call acts in: the one it names, else the Environment's Default domain, else the user's
 * only domain (the env-var Environment cannot set a Default domain).
 */
const domainIdFor = async (domainId: string | undefined, environment: Environment, custody: CustodyClient) => {
  const resolved = domainId ?? environment.defaultDomainId
  if (resolved !== undefined) {
    return resolved
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

// Added to the input of the list tools (`paged: true`).
const pageInput = {
  limit: z.number().int().min(1).max(100).default(20).describe('How many items to return (default 20, at most 100).'),
  cursor: z.string().optional().describe('The nextCursor of the previous page, to get the page after it.'),
}

/** The page a list tool asks Custody for. */
export type PageQuery = { limit: number; startingAfter?: string }

type RunArgs<Shape extends z.ZodRawShape> = {
  input: z.infer<z.ZodObject<Shape>>
  custody: CustodyClient
  environment: Environment
  /** Builds Explorer links for results on XRPL ledgers. */
  explorer: ExplorerLinks
  /** Mastra's execution context: the MCP request, and suspend/resume to ask the human. */
  context: ToolExecutionContext
}

type CustodyToolSpec<
  Shape extends z.ZodRawShape,
  Result extends object,
  Domain extends boolean,
  Paged extends boolean,
> = {
  id: string
  description: string
  /** The Access level the Environment needs for this tool (default `read`). */
  access?: AccessLevel
  /** Acts in one Custody domain: takes a `domainId` input, gets it resolved, and names it in the result. */
  domain?: Domain
  /** Lists one page at a time: takes `limit` and `cursor`, and gets the page to ask Custody for. */
  paged?: Paged
  input: Shape
  /** The form the human fills in when `run` suspends to ask them something (see `context.suspend`). */
  resumeSchema?: z.ZodObject
  run: (
    args: RunArgs<Shape> &
      (Domain extends true ? { domainId: string } : unknown) &
      (Paged extends true ? { pageQuery: PageQuery } : unknown),
  ) => Promise<Paged extends true ? Result & { nextCursor: string | undefined } : Result>
}

/**
 * Builds the tools that talk to Custody. Every such tool goes through here, so they all resolve the
 * Environment and Default domain the same way, reuse one client per Environment, name the Environment
 * (and domain) in their result, page the same way and turn any thrown value into a readable error.
 */
export const createCustodyToolFactory = (env: Record<string, string | undefined>, connect: ConnectCustody) => {
  // One client per Environment keeps its auth token across calls. The key is only read when a client
  // is made, and the client is remade when the Environment's settings change in the config file.
  const clients = new Map<
    string,
    { settings: string; custody: CustodyClient; explorer: ReturnType<typeof createExplorerLinks> }
  >()

  const findEnvironment = async (name: string | undefined) => {
    const { environments, defaultName } = await loadEnvironments(env)

    const wanted = name ?? defaultName
    const environment = environments.find(item => item.name === wanted)
    if (!environment) {
      const known = environments.map(item => item.name).join(', ')
      throw new Error(`Unknown Environment "${wanted}". Known Environments: ${known}.`)
    }
    return environment
  }

  const clientFor = async (environment: Environment) => {
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
      const custody = connect({ ...environment, privateKey })
      cached = { settings, custody, explorer: createExplorerLinks(custody) }
      clients.set(environment.name, cached)
    }
    return cached
  }

  return <
    Shape extends z.ZodRawShape,
    Result extends object,
    Domain extends boolean = false,
    Paged extends boolean = false,
  >(
    spec: CustodyToolSpec<Shape, Result, Domain, Paged>,
  ) => {
    const access = spec.access ?? 'read'
    return createTool({
      id: spec.id,
      description: spec.description,
      inputSchema: z.object({
        ...(access === 'read' ? environmentInput : writeEnvironmentInput),
        ...(spec.domain ? domainInput : {}),
        ...spec.input,
        ...(spec.paged ? pageInput : {}),
      }),
      resumeSchema: spec.resumeSchema,
      execute: async (inputData, context) => {
        // Generic shapes defeat zod's inference here; the schema above has already validated the input.
        const { environment: name, ...input } = inputData as { environment?: string } & Record<string, unknown>
        const environment = await findEnvironment(name)
        // Checked before the key is read, so a read-only Environment never reaches Custody.
        if (ACCESS_LEVELS.indexOf(environment.access) < ACCESS_LEVELS.indexOf(access)) {
          throw new Error(
            `${spec.id} needs the "${access}" Access level, but Environment "${environment.name}" has "${environment.access}".`,
          )
        }
        const { custody, explorer } = await clientFor(environment)
        try {
          const domainId = spec.domain
            ? await domainIdFor(input.domainId as string | undefined, environment, custody)
            : undefined
          const { limit, cursor } = input as { limit?: number; cursor?: string }
          const { nextCursor, ...result } = (await spec.run({
            input: input as z.infer<z.ZodObject<Shape>>,
            custody,
            environment,
            explorer: explorer(environment),
            context,
            ...(spec.domain ? { domainId } : {}),
            ...(spec.paged ? { pageQuery: { limit, startingAfter: cursor } } : {}),
            // The flags decide which arguments `run` gets; TypeScript cannot follow that through generics.
          } as Parameters<typeof spec.run>[0])) as Result & { nextCursor?: string }
          return {
            environment: environment.name,
            ...(domainId === undefined ? {} : { domainId }),
            ...result,
            // Omitted on the last page, so the model has no cursor to follow.
            ...(nextCursor === undefined ? {} : { nextCursor }),
          }
        } catch (error) {
          throw error instanceof Error ? error : new Error(JSON.stringify(error) ?? String(error))
        }
      },
    })
  }
}

export type DefineCustodyTool = ReturnType<typeof createCustodyToolFactory>
