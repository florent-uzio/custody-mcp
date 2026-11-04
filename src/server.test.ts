import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'
import { runCli } from './cli'
import { createCustodyMcpServer } from './server'
import { callTool, configFile, DEV, ENV_VARS, fakeCustody, NO_CONFIG } from './testing'

describe('custody MCP server', () => {
  it('returns the package name and version from getMcpVersion', async () => {
    const output = await callTool({ env: { CUSTODY_MCP_CONFIG: NO_CONFIG } }, 'getMcpVersion')

    expect(output).toEqual({ name: '@florent-uzio/custody-mcp', version: packageJson.version })
  })

  it('exposes each tool under its camelCase id', async () => {
    const { tools } = await createCustodyMcpServer({ env: { CUSTODY_MCP_CONFIG: NO_CONFIG } }).getToolListInfo()

    expect(tools.map(tool => tool.name).sort()).toEqual([
      'approveIntent',
      'decryptConfidentialInboxBalance',
      'dryRunIntent',
      'dryRunXrplIntent',
      'findAccountByAddress',
      'getAccount',
      'getAccountBalances',
      'getBackendVersion',
      'getConfidentialInboxDecryption',
      'getIntent',
      'getMcpVersion',
      'getMe',
      'getTransaction',
      'getTransfer',
      'listAccountAddresses',
      'listAccounts',
      'listDomains',
      'listEnvironments',
      'listIntents',
      'listLedgers',
      'listPendingApprovals',
      'listTickers',
      'listTransactionOrders',
      'listTransactions',
      'listTransfers',
      'listUsers',
      'proposeIntent',
      'proposeXrplIntent',
      'rejectIntent',
      'waitForIntent',
    ])
  })

  it('gives the client instructions on Environments', () => {
    const { instructions } = createCustodyMcpServer({ env: { CUSTODY_MCP_CONFIG: NO_CONFIG } })

    expect(instructions).toContain('Say which Environment you used')
  })

  it('tells the assistant to get an explicit yes before an Approve or Reject the client cannot confirm', () => {
    const { instructions } = createCustodyMcpServer({ env: { CUSTODY_MCP_CONFIG: NO_CONFIG } })

    expect(instructions).toContain('approveIntent or rejectIntent')
    expect(instructions).toContain('explicit "yes"')
  })

  describe('Environments from the config file', () => {
    it('lists each Environment in the config file', async () => {
      const CUSTODY_MCP_CONFIG = configFile({
        default: 'dev',
        environments: {
          dev: {
            ...DEV,
            keyReference: 'env:DEV_KEY',
            access: 'propose',
            defaultDomainId: 'domain-1',
            xrplNodes: { 'xrpl-sandbox': 'wss://sandbox.example.test:6006' },
          },
        },
      })

      const output = await callTool({ env: { CUSTODY_MCP_CONFIG } }, 'listEnvironments')

      expect(output).toEqual({
        environments: [
          {
            name: 'dev',
            authUrl: 'https://auth.dev.test/token',
            apiUrl: 'https://api.dev.test',
            access: 'propose',
            defaultDomainId: 'domain-1',
            xrplNodes: { 'xrpl-sandbox': 'wss://sandbox.example.test:6006' },
            isDefault: true,
          },
        ],
      })
    })

    it('tells the user how to set up an Environment when none is configured', async () => {
      const output = await callTool({ env: { CUSTODY_MCP_CONFIG: NO_CONFIG } }, 'listEnvironments')

      expect(output).toEqual({
        error: 'No Environment configured. Run `npx @florent-uzio/custody-mcp@latest add-env <name>` to set one up.',
      })
    })

    it('refuses an unknown Access level in the config file instead of guessing one', async () => {
      const CUSTODY_MCP_CONFIG = configFile({
        environments: { dev: { ...DEV, keyReference: 'env:X', access: 'admin' } },
      })

      const output = await callTool({ env: { CUSTODY_MCP_CONFIG } }, 'listEnvironments')

      expect(output).toEqual({ error: expect.stringContaining(`Invalid config file ${CUSTODY_MCP_CONFIG}`) })
      expect(output).toEqual({ error: expect.stringContaining('environments.dev.access') })
    })

    it('names the config file when it is not valid JSON', async () => {
      const CUSTODY_MCP_CONFIG = configFile()
      writeFileSync(CUSTODY_MCP_CONFIG, '{ not json')

      const output = await callTool({ env: { CUSTODY_MCP_CONFIG } }, 'listEnvironments')

      expect(output).toEqual({ error: expect.stringContaining(`Invalid config file ${CUSTODY_MCP_CONFIG}`) })
    })

    it('says when the default in the config file names no Environment', async () => {
      const CUSTODY_MCP_CONFIG = configFile({
        default: 'prod',
        environments: { dev: { ...DEV, keyReference: 'env:X' } },
      })

      const output = await callTool({ env: { CUSTODY_MCP_CONFIG } }, 'listEnvironments')

      expect(output).toEqual({
        error: `Invalid config file ${CUSTODY_MCP_CONFIG}: the default Environment "prod" is not defined. Known Environments: dev.`,
      })
    })

    it('lists the env-var Environment alongside them and marks the default from the config', async () => {
      const CUSTODY_MCP_CONFIG = configFile({
        default: 'staging',
        environments: {
          dev: { ...DEV, keyReference: 'env:DEV_KEY' },
          staging: { ...DEV, keyReference: 'env:STAGING_KEY', access: 'approve' },
        },
      })

      const output = await callTool({ env: { ...ENV_VARS, CUSTODY_MCP_CONFIG } }, 'listEnvironments')

      expect(output).toMatchObject({
        environments: [
          { name: 'dev', access: 'read', isDefault: false },
          { name: 'staging', access: 'approve', isDefault: true },
          { name: 'env', access: 'read', isDefault: false },
        ],
      })
    })
  })

  describe('a read tool', () => {
    const ME = { publicKey: DEV.publicKey, domains: [] }

    /** A key file in a fresh temp dir, referenced the way the config file does. */
    const keyFile = (key: string) => {
      const file = path.join(mkdtempSync(path.join(tmpdir(), 'custody-mcp-key-')), 'key.pem')
      writeFileSync(file, key)
      return `file:${file}`
    }

    it('uses the default Environment from the config file, with the key its file: reference points at', async () => {
      const CUSTODY_MCP_CONFIG = configFile({
        default: 'staging',
        environments: {
          dev: { ...DEV, keyReference: keyFile('DEV KEY') },
          staging: { ...DEV, apiUrl: 'https://api.staging.test', keyReference: keyFile('STAGING KEY') },
        },
      })
      const connect = vi.fn(() => fakeCustody({ users: { me: async () => ME } }))

      const output = await callTool({ env: { CUSTODY_MCP_CONFIG }, connect }, 'getMe')

      expect(output).toEqual({ environment: 'staging', me: ME })
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'staging', apiUrl: 'https://api.staging.test', privateKey: 'STAGING KEY' }),
      )
    })

    it('follows edits to the config file without a restart', async () => {
      const CUSTODY_MCP_CONFIG = configFile({ environments: { dev: { ...DEV, keyReference: keyFile('OLD KEY') } } })
      const connect = vi.fn(() => fakeCustody({ users: { me: async () => ME } }))
      const server = createCustodyMcpServer({ env: { CUSTODY_MCP_CONFIG }, connect })
      await server.executeTool('getMe', {})

      writeFileSync(
        CUSTODY_MCP_CONFIG,
        JSON.stringify({ environments: { dev: { ...DEV, keyReference: keyFile('NEW KEY') } } }),
      )
      await server.executeTool('getMe', {})

      expect(connect).toHaveBeenCalledTimes(2)
      expect(connect).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'dev', privateKey: 'NEW KEY' }))
    })

    it('can use an Environment add-env saved while it was running', async () => {
      const CUSTODY_MCP_CONFIG = configFile({ environments: { dev: { ...DEV, keyReference: keyFile('DEV KEY') } } })
      const connect = vi.fn(() => fakeCustody({ users: { me: async () => ME } }))
      const server = createCustodyMcpServer({ env: { CUSTODY_MCP_CONFIG }, connect })
      await server.executeTool('listEnvironments', {})
      const answers = ['https://auth.demo.test/token', 'https://api.demo.test', '', '', '']

      await runCli(['add-env', 'demo', '--store', 'file'], {
        env: { CUSTODY_MCP_CONFIG },
        ask: async () => answers.shift() ?? '',
        print: () => {},
        keychain: { set: async () => {} },
        connect,
      })
      const result = await server.executeTool('getMe', { environment: 'demo' })

      expect(result).toMatchObject({ output: { environment: 'demo', me: ME } })
      expect(connect).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: 'demo',
          apiUrl: 'https://api.demo.test',
          privateKey: expect.stringContaining('PRIVATE KEY'),
        }),
      )
    })

    it('fails only the Environment whose Key reference is broken, saying which one', async () => {
      const CUSTODY_MCP_CONFIG = configFile({
        default: 'dev',
        environments: {
          dev: { ...DEV, keyReference: keyFile('DEV KEY') },
          broken: { ...DEV, keyReference: 'env:MISSING_KEY' },
        },
      })
      const options = { env: { CUSTODY_MCP_CONFIG }, connect: () => fakeCustody({ users: { me: async () => ME } }) }

      const broken = await callTool(options, 'getMe', { environment: 'broken' })
      const dev = await callTool(options, 'getMe')

      expect(broken).toEqual({
        error:
          'Cannot read the private key of Environment "broken" from env:MISSING_KEY: env var MISSING_KEY is not set',
      })
      expect(dev).toEqual({ environment: 'dev', me: ME })
    })
  })

  describe('the env-var Environment', () => {
    it('lists the four env vars as a read-only Environment named env', async () => {
      const output = await callTool({ env: ENV_VARS }, 'listEnvironments')

      expect(output).toEqual({
        environments: [
          {
            name: 'env',
            authUrl: 'https://auth.example.test/token',
            apiUrl: 'https://api.example.test',
            access: 'read',
            isDefault: true,
          },
        ],
      })
    })

    it('takes its Access level from CUSTODY_ACCESS', async () => {
      const output = await callTool({ env: { ...ENV_VARS, CUSTODY_ACCESS: 'propose' } }, 'listEnvironments')

      expect(output).toMatchObject({ environments: [{ name: 'env', access: 'propose' }] })
    })

    it('refuses an unknown CUSTODY_ACCESS instead of guessing a level', async () => {
      const output = await callTool({ env: { ...ENV_VARS, CUSTODY_ACCESS: 'admin' } }, 'listEnvironments')

      expect(output).toEqual({ error: 'CUSTODY_ACCESS must be one of read, propose, approve (got "admin")' })
    })

    it('never shows the private key', async () => {
      const output = await callTool({ env: ENV_VARS }, 'listEnvironments')

      expect(JSON.stringify(output)).not.toContain('SECRET')
    })
  })

  describe('getMe', () => {
    const ME = {
      publicKey: ENV_VARS.PUBLIC_KEY,
      domains: [{ id: 'domain-1', alias: 'Demo', user: { id: 'user-1', alias: 'florent', roles: ['proposer'] } }],
    }

    it('returns the Custody user of the Environment and names the Environment', async () => {
      const custody = fakeCustody({ users: { me: async () => ME } })

      const output = await callTool({ env: ENV_VARS, connect: () => custody }, 'getMe')

      expect(output).toEqual({ environment: 'env', me: ME })
    })

    it('connects with the Environment credentials', async () => {
      const connect = vi.fn(() => fakeCustody({ users: { me: async () => ME } }))

      await callTool({ env: ENV_VARS, connect }, 'getMe')

      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'env',
          authUrl: ENV_VARS.AUTH_URL,
          apiUrl: ENV_VARS.API_URL,
          publicKey: ENV_VARS.PUBLIC_KEY,
          privateKey: ENV_VARS.PRIVATE_KEY,
        }),
      )
    })

    it('reuses one Custody client per Environment across calls', async () => {
      const connect = vi.fn(() => fakeCustody({ users: { me: async () => ME } }))
      const server = createCustodyMcpServer({ env: ENV_VARS, connect })

      await server.executeTool('getMe', {})
      await server.executeTool('getMe', {})

      expect(connect).toHaveBeenCalledTimes(1)
    })

    it('tells the user how to set up an Environment when none is configured', async () => {
      const output = await callTool({ env: { CUSTODY_MCP_CONFIG: NO_CONFIG }, connect: () => fakeCustody({}) }, 'getMe')

      expect(output).toEqual({
        error: 'No Environment configured. Run `npx @florent-uzio/custody-mcp@latest add-env <name>` to set one up.',
      })
    })

    it('refuses an unknown Environment and lists the known ones', async () => {
      const output = await callTool({ env: ENV_VARS, connect: () => fakeCustody({}) }, 'getMe', {
        environment: 'staging',
      })

      expect(output).toEqual({ error: 'Unknown Environment "staging". Known Environments: env.' })
    })

    it('reports a Custody failure as a readable error', async () => {
      const custody = fakeCustody({
        users: {
          me: async () => {
            throw new Error('401 Unauthorized: public key not registered')
          },
        },
      })

      const output = await callTool({ env: ENV_VARS, connect: () => custody }, 'getMe')

      expect(output).toEqual({ error: '401 Unauthorized: public key not registered' })
    })
  })
})
