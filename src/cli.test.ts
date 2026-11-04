import { KeypairService } from '@florent-uzio/custody'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from './cli'
import type { CustodyClient } from './custody'
import { configFile, DEV, ENV_VARS, fakeCustody } from './testing'

/** A Keychain that lives in memory. */
const fakeKeychain = () => {
  const items = new Map<string, string>()
  return {
    items,
    set: async (service: string, account: string, secret: string) => void items.set(`${service}/${account}`, secret),
  }
}

const ME = {
  publicKey: 'ignored',
  domains: [{ id: 'domain-1', alias: 'Treasury', userId: 'user-1', userAlias: 'Florent', roles: [] }],
}

// Auth URL, API URL, Enter once the key is registered, then the defaults for domain and Access level.
const URLS_AND_DEFAULTS = ['https://auth.dev.test/token', 'https://api.dev.test', '', '', '']

/** Runs the CLI with scripted answers to its questions, as a person would type them. */
const run = async (
  argv: string[],
  { answers = [], config = configFile(), env = {}, custody = fakeCustody({ users: { me: async () => ME } }) } = {} as {
    answers?: string[]
    config?: string
    env?: Record<string, string>
    custody?: CustodyClient
  },
) => {
  const keychain = fakeKeychain()
  const script = [...answers]
  const questions: string[] = []
  const printed: string[] = []
  const connected: object[] = []
  const exitCode = await runCli(argv, {
    env: { ...env, CUSTODY_MCP_CONFIG: config },
    ask: async question => {
      questions.push(question)
      const answer = script.shift()
      if (answer === undefined) throw new Error(`No scripted answer for: ${question}`)
      return answer
    },
    print: line => void printed.push(line),
    keychain,
    connect: environment => {
      connected.push(environment)
      return custody
    },
  })
  const readConfig = () => JSON.parse(readFileSync(config, 'utf8'))
  return { exitCode, questions, output: printed.join('\n'), keychain, connected, readConfig }
}

describe('setup CLI', () => {
  describe('add-env', () => {
    it('saves no Default domain when the user belongs to no domain', async () => {
      const custody = fakeCustody({ users: { me: async () => ({ ...ME, domains: [] }) } })
      const [authUrl, apiUrl, registered, , access] = URLS_AND_DEFAULTS

      const result = await run(['add-env', 'dev'], { custody, answers: [authUrl, apiUrl, registered, access] })

      expect(result.exitCode).toBe(0)
      expect(result.readConfig().environments.dev).not.toHaveProperty('defaultDomainId')
      expect(result.questions.some(question => question.startsWith('Default domain'))).toBe(false)
    })

    it('refuses a name already in the config file', async () => {
      const config = configFile({ environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY' } } })

      const result = await run(['add-env', 'dev'], { config })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('Environment "dev" already exists')
      expect(result.questions).toEqual([])
    })

    it('needs a name', async () => {
      const result = await run(['add-env'])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('Usage: custody-mcp add-env <name>')
    })

    it("offers the user's domains as the Default domain and asks again after an invalid answer", async () => {
      const custody = fakeCustody({
        users: {
          me: async () => ({
            ...ME,
            domains: [...ME.domains, { id: 'domain-2', alias: 'Operations', userId: 'user-2', roles: [] }],
          }),
        },
      })
      const [authUrl, apiUrl, registered] = URLS_AND_DEFAULTS

      const result = await run(['add-env', 'dev'], {
        custody,
        answers: [authUrl, apiUrl, registered, '9', '2', 'admin', 'propose'],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('1. Treasury (domain-1)\n2. Operations (domain-2)')
      expect(result.readConfig().environments.dev).toMatchObject({ defaultDomainId: 'domain-2', access: 'propose' })
    })

    it('does not save the Environment when the login check fails', async () => {
      const config = configFile()
      const custody = fakeCustody({
        users: {
          me: async () => {
            throw new Error('401 Unauthorized')
          },
        },
      })

      const result = await run(['add-env', 'dev'], { config, custody, answers: URLS_AND_DEFAULTS })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('401 Unauthorized')
      expect(existsSync(config)).toBe(false)
    })

    it('points at a private key already in an env var with --store env', async () => {
      const existing = new KeypairService('ed25519').generate()
      const [authUrl, apiUrl, ...rest] = URLS_AND_DEFAULTS

      const result = await run(['add-env', 'dev', '--store', 'env'], {
        env: { DEV_PRIVATE_KEY: existing.privateKey },
        answers: [authUrl, apiUrl, 'DEV_PRIVATE_KEY', ...rest],
      })

      expect(result.exitCode).toBe(0)
      const saved = result.readConfig().environments.dev
      expect(saved.keyReference).toBe('env:DEV_PRIVATE_KEY')
      expect(saved.publicKey).toBe(existing.publicKey)
      expect(result.output).not.toContain('PRIVATE KEY')
    })

    it('refuses --import with --store env, before asking anything', async () => {
      const result = await run(['add-env', 'dev', '--import', 'key.pem', '--store', 'env'])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('--import cannot be used with --store env')
      expect(result.questions).toEqual([])
    })

    it('stores the key in a file next to the config with --store file', async () => {
      const config = configFile()

      const result = await run(['add-env', 'dev', '--store', 'file'], { config, answers: URLS_AND_DEFAULTS })

      expect(result.exitCode).toBe(0)
      const keyFile = path.join(path.dirname(config), 'keys', 'dev.pem')
      expect(result.readConfig().environments.dev.keyReference).toBe(`file:${keyFile}`)
      expect(readFileSync(keyFile, 'utf8')).toContain('-----BEGIN PRIVATE KEY-----')
      expect(statSync(keyFile).mode & 0o777).toBe(0o600)
      expect(result.keychain.items.size).toBe(0)
    })

    it('saves an Environment with a generated key stored in the Keychain', async () => {
      const result = await run(['add-env', 'dev'], {
        answers: URLS_AND_DEFAULTS,
      })

      expect(result.exitCode).toBe(0)
      const saved = result.readConfig().environments.dev
      expect(saved).toEqual({
        authUrl: 'https://auth.dev.test/token',
        apiUrl: 'https://api.dev.test',
        publicKey: expect.stringMatching(/^MCowBQYDK2VwAyEA/), // base64 DER of an ed25519 key
        keyReference: 'keychain:custody-mcp/dev',
        access: 'read',
        defaultDomainId: 'domain-1',
      })
      expect(result.output).toContain(saved.publicKey)
      expect(result.keychain.items.get('custody-mcp/dev')).toContain('-----BEGIN PRIVATE KEY-----')
    })

    it('generates a key with the algorithm --algorithm names', async () => {
      const result = await run(['add-env', 'dev', '--algorithm', 'secp256k1'], { answers: URLS_AND_DEFAULTS })

      expect(result.exitCode).toBe(0)
      // base64 DER of a secp256k1 public key
      expect(result.readConfig().environments.dev.publicKey).toMatch(/^MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE/)
    })

    it.each(['ed25519', 'secp256k1', 'secp256r1'] as const)(
      'imports an existing %s private key PEM',
      async algorithm => {
        const existing = new KeypairService(algorithm).generate()
        const pem = path.join(mkdtempSync(path.join(tmpdir(), 'custody-mcp-key-')), 'key.pem')
        writeFileSync(pem, existing.privateKey)

        const result = await run(['add-env', 'dev', '--import', pem], { answers: URLS_AND_DEFAULTS })

        expect(result.exitCode).toBe(0)
        expect(result.readConfig().environments.dev.publicKey).toBe(existing.publicKey)
        expect(result.keychain.items.get('custody-mcp/dev')).toBe(existing.privateKey)
      },
    )
  })

  describe('list-envs', () => {
    it('shows each Environment and where its key is stored, never the key', async () => {
      const config = configFile({
        default: 'dev',
        environments: {
          dev: { ...DEV, keyReference: 'keychain:custody-mcp/dev', access: 'approve', defaultDomainId: 'domain-1' },
          demo: { ...DEV, apiUrl: 'https://api.demo.test', keyReference: 'file:/keys/demo.pem' },
        },
      })

      const result = await run(['list-envs'], { config, env: { ...ENV_VARS, CUSTODY_MCP_CONFIG: config } })

      expect(result.exitCode).toBe(0)
      expect(result.output).toBe(
        [
          'dev (default)',
          '  Auth URL: https://auth.dev.test/token',
          '  API URL: https://api.dev.test',
          '  Access level: approve',
          '  Default domain: domain-1',
          '  Key: keychain:custody-mcp/dev',
          'demo',
          '  Auth URL: https://auth.dev.test/token',
          '  API URL: https://api.demo.test',
          '  Access level: read',
          '  Default domain: none',
          '  Key: file:/keys/demo.pem',
          'env',
          '  Auth URL: https://auth.example.test/token',
          '  API URL: https://api.example.test',
          '  Access level: read',
          '  Default domain: none',
          '  Key: env:PRIVATE_KEY',
        ].join('\n'),
      )
      expect(result.output).not.toContain(ENV_VARS.PRIVATE_KEY)
    })

    it('says to run add-env when nothing is configured', async () => {
      const result = await run(['list-envs'])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('add-env <name>')
    })
  })

  describe('remove-env', () => {
    const twoEnvironments = () =>
      configFile({
        default: 'dev',
        environments: {
          dev: { ...DEV, keyReference: 'keychain:custody-mcp/dev', access: 'read' },
          demo: { ...DEV, keyReference: 'file:/keys/demo.pem', access: 'read' },
        },
      })

    it('removes the Environment from the config file and says where its key still is', async () => {
      const result = await run(['remove-env', 'demo'], { config: twoEnvironments() })

      expect(result.exitCode).toBe(0)
      expect(Object.keys(result.readConfig().environments)).toEqual(['dev'])
      expect(result.readConfig().default).toBe('dev')
      expect(result.output).toContain('file:/keys/demo.pem')
    })

    it('clears the default when it removes the default Environment', async () => {
      const result = await run(['remove-env', 'dev'], { config: twoEnvironments() })

      expect(result.exitCode).toBe(0)
      expect(result.readConfig()).toEqual({ environments: { demo: expect.any(Object) } })
    })

    it('refuses an unknown Environment', async () => {
      const config = twoEnvironments()

      const result = await run(['remove-env', 'staging'], { config })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('Unknown Environment "staging"')
      expect(Object.keys(result.readConfig().environments)).toEqual(['dev', 'demo'])
    })
  })

  describe('set-default', () => {
    const config = () =>
      configFile({
        default: 'dev',
        environments: {
          dev: { ...DEV, keyReference: 'keychain:custody-mcp/dev', access: 'read' },
          demo: { ...DEV, keyReference: 'file:/keys/demo.pem', access: 'read' },
        },
      })

    it('makes the named Environment the default', async () => {
      const result = await run(['set-default', 'demo'], { config: config() })

      expect(result.exitCode).toBe(0)
      expect(result.readConfig().default).toBe('demo')
    })

    it('refuses an unknown Environment', async () => {
      const result = await run(['set-default', 'staging'], { config: config() })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('Unknown Environment "staging"')
      expect(result.readConfig().default).toBe('dev')
    })
  })
})
