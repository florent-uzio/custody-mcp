import { KeypairService, type KeypairAlgorithm } from '@florent-uzio/custody'
import { createPublicKey } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { ConnectCustody } from './custody'
import { ACCESS_LEVELS, configPath, loadEnvironments, readConfig } from './environments'

/** The macOS Keychain, as the CLI uses it (see keychain.ts). */
export type Keychain = {
  set: (service: string, account: string, secret: string) => Promise<void>
}

export type CliOptions = {
  env: Record<string, string | undefined>
  /** Asks the person a question and returns what they typed. */
  ask: (question: string) => Promise<string>
  print: (line: string) => void
  keychain: Keychain
  connect: ConnectCustody
}

const KEYCHAIN_SERVICE = 'custody-mcp'

const USAGE: Record<string, string> = {
  'add-env':
    'custody-mcp add-env <name> [--algorithm ed25519|secp256k1|secp256r1] [--import <pem-file> | --paste] [--store keychain|file|env]',
  'list-envs': 'custody-mcp list-envs',
  'remove-env': 'custody-mcp remove-env <name>',
  'set-default': 'custody-mcp set-default <name>',
}

const isHelp = (arg: string) => arg === '--help' || arg === '-h'

const usageOfEveryCommand = () =>
  [
    'Usage:',
    ...Object.values(USAGE).map(line => `  ${line}`),
    '',
    'With no command, custody-mcp runs the MCP server.',
  ].join('\n')

/** The setup subcommands of the bin; returns the process exit code. */
export const runCli = async (argv: string[], options: CliOptions): Promise<number> => {
  const [command, ...args] = argv
  const commands: Record<string, (args: string[], options: CliOptions) => Promise<number>> = {
    'add-env': addEnv,
    'list-envs': listEnvs,
    'remove-env': removeEnv,
    'set-default': setDefault,
  }
  if (isHelp(command)) {
    options.print(usageOfEveryCommand())
    return 0
  }
  const run = commands[command]
  if (run === undefined) {
    options.print(`Unknown command "${command}".\n\n${usageOfEveryCommand()}`)
    return 1
  }
  if (args.some(isHelp)) {
    options.print(`Usage: ${USAGE[command]}`)
    return 0
  }
  try {
    return await run(args, options)
  } catch (error) {
    options.print((error as Error).message)
    return 1
  }
}

const listEnvs = async (_args: string[], { env, print }: CliOptions) => {
  const { environments, defaultName } = await loadEnvironments(env)
  for (const environment of environments) {
    // Field by field, like the listEnvironments tool: key material must never be printed.
    print(
      [
        environment.name === defaultName ? `${environment.name} (default)` : environment.name,
        `  Auth URL: ${environment.authUrl}`,
        `  API URL: ${environment.apiUrl}`,
        `  Access level: ${environment.access}`,
        `  Default domain: ${environment.defaultDomainId ?? 'none'}`,
        `  Key: ${environment.keyReference}`,
      ].join('\n'),
    )
  }
  return 0
}

const removeEnv = async ([name]: string[], { env, print }: CliOptions) => {
  if (name === undefined) {
    print(`Usage: ${USAGE['remove-env']}`)
    return 1
  }
  const file = configPath(env)
  let keyReference: string | undefined
  await updateConfig(file, config => {
    keyReference = environmentIn(config, name, file).keyReference
    delete config.environments[name]
    if (config.default === name) {
      delete config.default
    }
  })
  print(
    `Removed Environment "${name}". Its private key is still at ${keyReference}: delete it there if you no longer need it.`,
  )
  return 0
}

const setDefault = async ([name]: string[], { env, print }: CliOptions) => {
  if (name === undefined) {
    print(`Usage: ${USAGE['set-default']}`)
    return 1
  }
  const file = configPath(env)
  await updateConfig(file, config => {
    environmentIn(config, name, file)
    config.default = name
  })
  print(`"${name}" is now the default Environment.`)
  return 0
}

const addEnv = async (args: string[], { env, ask, print, keychain, connect }: CliOptions) => {
  const {
    positionals: [name],
    values,
  } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      algorithm: { type: 'string', default: 'ed25519' },
      import: { type: 'string' },
      paste: { type: 'boolean', default: false },
      store: { type: 'string', default: 'keychain' },
    },
  })
  if (name === undefined) {
    print(`Usage: ${USAGE['add-env']}`)
    return 1
  }
  if (values.paste && values.import !== undefined) {
    print('Use either --import or --paste, not both.')
    return 1
  }
  if (values.store === 'env' && (values.import !== undefined || values.paste)) {
    const flag = values.paste ? '--paste' : '--import'
    print(`${flag} cannot be used with --store env: --store env reads the private key from an env var instead.`)
    return 1
  }
  const file = configPath(env)
  if ((await readConfig(file)).environments[name] !== undefined) {
    print(`Environment "${name}" already exists in ${file}. Run remove-env ${name} first to replace it.`)
    return 1
  }

  const authUrl = await ask('Auth URL: ')
  const apiUrl = await ask('API URL: ')

  let keypair: { privateKey: string; publicKey: string }
  let keyReference: string
  if (values.store === 'env') {
    // An env var cannot be set from here, so this store only points at a key the person already exported.
    const variable = await ask('Env var that holds the private key PEM: ')
    const pem = env[variable]
    if (!pem) {
      print(`Env var ${variable} is not set.`)
      return 1
    }
    keypair = keypairFromPem(pem)
    keyReference = `env:${variable}`
  } else {
    if (values.paste) {
      keypair = keypairFromPem(normalizePem(await askForPem(ask)))
    } else if (values.import !== undefined) {
      keypair = keypairFromPem(await readFile(values.import, 'utf8'))
    } else {
      keypair = new KeypairService(values.algorithm as KeypairAlgorithm).generate()
    }
    keyReference = await storeKey(values.store, { name, privateKey: keypair.privateKey, configFile: file, keychain })
  }
  const { privateKey, publicKey } = keypair

  print(`Register this public key for your Custody user:\n\n${publicKey}\n`)
  await ask('Press Enter once it is registered. ')

  const custody = connect({ name, authUrl, apiUrl, publicKey, keyReference, access: 'read', privateKey })
  let domains: { id: string; alias: string }[]
  try {
    ;({ domains } = await custody.users.me())
  } catch (error) {
    print(
      `Cannot log in to Custody as this key: ${(error as Error).message}\nCheck the URLs and that the public key is registered, then run add-env again.`,
    )
    return 1
  }
  const defaultDomainId = await chooseDomain(domains, { ask, print })
  const access = await choose(ask, 'Access level (read, propose, approve) [read]: ', ACCESS_LEVELS, 'read')

  await updateConfig(file, config => {
    config.environments[name] = { authUrl, apiUrl, publicKey, keyReference, access, defaultDomainId }
  })
  print(`Saved Environment "${name}" to ${file}.`)
  return 0
}

type Config = Awaited<ReturnType<typeof readConfig>>

/** Re-reads the config file just before changing it, so an edit made meanwhile is not lost. */
const updateConfig = async (file: string, change: (config: Config) => void) => {
  const config = await readConfig(file)
  change(config)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(config, null, 2) + '\n')
}

const environmentIn = (config: Config, name: string, file: string) => {
  const environment = config.environments[name]
  if (environment === undefined) {
    const known = Object.keys(config.environments).join(', ') || 'none'
    throw new Error(`Unknown Environment "${name}" in ${file}. Known Environments: ${known}.`)
  }
  return environment
}

/**
 * Reads a pasted private key PEM. The paste may be one line with literal `\n` separators or several lines,
 * so lines are read until the PEM footer (or an empty line, once something was pasted).
 */
const askForPem = async (ask: CliOptions['ask']) => {
  const lines = [await ask('Paste the private key PEM (literal \\n or real line breaks both work): ')]
  // Keep reading only while a PEM has begun but not ended.
  while (lines[0].includes('-----BEGIN') && !lines.join('\n').includes('-----END')) {
    const line = await ask('')
    if (line.trim() === '') break
    lines.push(line)
  }
  return lines.join('\n')
}

/** Turns a pasted key into a PEM: drops wrapping quotes and turns literal `\n` into line breaks. */
const normalizePem = (pasted: string) => {
  const pem = pasted
    .trim()
    .replace(/^(["'`])([\s\S]*)\1$/, '$2')
    .replace(/\\r\\n|\\n/g, '\n')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n')
  return pem + '\n'
}

/** Derives the public key of a private key PEM, in the form Custody expects (base64 DER). */
const keypairFromPem = (privateKey: string) => {
  let publicKey: string
  try {
    publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')
  } catch {
    throw new Error(
      'That is not a valid private key PEM (expected -----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----).',
    )
  }
  return { privateKey, publicKey }
}

/** Writes the private key to the chosen store and returns the Key reference to it (ADR-0002). */
const storeKey = async (
  store: string,
  {
    name,
    privateKey,
    configFile,
    keychain,
  }: { name: string; privateKey: string; configFile: string; keychain: Keychain },
) => {
  if (store === 'file') {
    const keyFile = path.join(path.dirname(configFile), 'keys', `${name}.pem`)
    await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 })
    await writeFile(keyFile, privateKey, { mode: 0o600 })
    return `file:${keyFile}`
  }
  await keychain.set(KEYCHAIN_SERVICE, name, privateKey)
  return `keychain:${KEYCHAIN_SERVICE}/${name}`
}

/** Offers the user's domains as the Default domain; a user in no domain gets none. */
const chooseDomain = async (
  domains: { id: string; alias: string }[],
  { ask, print }: Pick<CliOptions, 'ask' | 'print'>,
) => {
  if (domains.length === 0) {
    print('Your Custody user belongs to no domain yet, so the Environment gets no Default domain.')
    return undefined
  }
  print(domains.map((domain, index) => `${index + 1}. ${domain.alias} (${domain.id})`).join('\n'))
  const choices = domains.map((_, index) => String(index + 1))
  return domains[Number(await choose(ask, 'Default domain [1]: ', choices, '1')) - 1].id
}

/** Asks until the answer is one of `choices`; an empty answer picks `fallback`. */
const choose = async <Choice extends string>(
  ask: CliOptions['ask'],
  question: string,
  choices: readonly Choice[],
  fallback: Choice,
): Promise<Choice> => {
  for (;;) {
    const answer = (await ask(question)).trim() || fallback
    if ((choices as readonly string[]).includes(answer)) {
      return answer as Choice
    }
  }
}
