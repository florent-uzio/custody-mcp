import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

export const ACCESS_LEVELS = ['read', 'propose', 'approve'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/** A named Ripple Custody instance with the credentials of one Custody user on it (see GLOSSARY.md). */
export type Environment = {
  name: string
  authUrl: string
  apiUrl: string
  publicKey: string
  /** Where the private key lives (`file:<path>`, `env:<VAR>`), never the key itself (ADR-0002). */
  keyReference: string
  access: AccessLevel
  defaultDomainId?: string
}

export type Environments = {
  environments: Environment[]
  /** Name of the Environment read tools use when a call does not name one. */
  defaultName: string | undefined
}

type Env = Record<string, string | undefined>

const configSchema = z.object({
  default: z.string().optional(),
  environments: z
    .record(
      z.string(),
      z.object({
        authUrl: z.string(),
        apiUrl: z.string(),
        publicKey: z.string(),
        keyReference: z.string(),
        access: z.enum(ACCESS_LEVELS).default('read'),
        defaultDomainId: z.string().optional(),
      }),
    )
    .default({}),
})

/**
 * Reads the config file and merges in the env-var Environment `env`. Called on every tool call, so
 * an edit to the file takes effect without a restart. Throws the setup hint when nothing is configured.
 */
export const loadEnvironments = async (env: Env): Promise<Environments> => {
  const file = configPath(env)
  const config = await readConfig(file)
  const environments = [
    ...Object.entries(config.environments).map(([name, environment]) => ({ name, ...environment })),
    ...environmentsFromEnv(env),
  ]
  if (environments.length === 0) {
    throw new Error('No Environment configured. Run `npx @florent-uzio/custody-mcp add-env <name>` to set one up.')
  }
  if (config.default !== undefined && !environments.some(item => item.name === config.default)) {
    const known = environments.map(item => item.name).join(', ')
    throw new Error(
      `Invalid config file ${file}: the default Environment "${config.default}" is not defined. Known Environments: ${known}.`,
    )
  }
  return { environments, defaultName: config.default ?? environments[0]?.name }
}

const configPath = (env: Env) => env.CUSTODY_MCP_CONFIG ?? path.join(homedir(), '.config', 'custody-mcp', 'config.json')

const readConfig = async (file: string) => {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    // No file yet just means nothing is configured: the server must still start.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return configSchema.parse({})
    }
    throw error
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid config file ${file}: ${(error as Error).message}`)
  }
  const result = configSchema.safeParse(json)
  if (!result.success) {
    throw new Error(`Invalid config file ${file}:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

/** The four env vars custody-mpt-demo uses become one Environment named `env` (ADR-0002). */
const environmentsFromEnv = (env: Env): Environment[] => {
  const { AUTH_URL, API_URL, PUBLIC_KEY, PRIVATE_KEY } = env
  if (!AUTH_URL || !API_URL || !PUBLIC_KEY || !PRIVATE_KEY) {
    return []
  }

  return [
    {
      name: 'env',
      authUrl: AUTH_URL,
      apiUrl: API_URL,
      publicKey: PUBLIC_KEY,
      keyReference: 'env:PRIVATE_KEY',
      access: parseAccessLevel(env.CUSTODY_ACCESS),
    },
  ]
}

// An unknown value fails closed: guessing could make an Environment writable by mistake.
const parseAccessLevel = (value: string | undefined): AccessLevel => {
  if (value === undefined) {
    return 'read'
  }
  if (!(ACCESS_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`CUSTODY_ACCESS must be one of ${ACCESS_LEVELS.join(', ')} (got "${value}")`)
  }
  return value as AccessLevel
}
