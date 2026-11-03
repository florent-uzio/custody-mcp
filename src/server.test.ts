import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'
import type { CustodyClient } from './custody'
import { createCustodyMcpServer, type ServerOptions } from './server'

const ENV_VARS = {
  AUTH_URL: 'https://auth.example.test/token',
  API_URL: 'https://api.example.test',
  PUBLIC_KEY: 'MCowBQYDK2VwAyEAPUBLICKEYPUBLICKEYPUBLICKEYPUBLICKEYPU=',
  PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nSECRETSECRETSECRET\n-----END PRIVATE KEY-----',
}

/** Stands in for custody.js: only the namespaces a test needs, with canned answers. */
const fakeCustody = (namespaces: object) => namespaces as CustodyClient

const callTool = async (options: ServerOptions, toolId: string, args: object = {}) => {
  try {
    const result = await createCustodyMcpServer(options).executeTool(toolId, args)
    return (result as { output?: unknown }).output
  } catch (error) {
    return { error: (error as Error).message }
  }
}

describe('custody MCP server', () => {
  it('returns the package name and version from getMcpVersion', async () => {
    const output = await callTool({ env: {} }, 'getMcpVersion')

    expect(output).toEqual({ name: '@florent-uzio/custody-mcp', version: packageJson.version })
  })

  it('exposes each tool under its camelCase id', async () => {
    const { tools } = await createCustodyMcpServer({ env: {} }).getToolListInfo()

    expect(tools.map(tool => tool.name).sort()).toEqual(['getMcpVersion', 'getMe', 'listEnvironments'])
  })

  it('gives the client instructions on Environments', () => {
    const { instructions } = createCustodyMcpServer({ env: {} })

    expect(instructions).toContain('Say which Environment you used')
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
      const output = await callTool({ env: {}, connect: () => fakeCustody({}) }, 'getMe')

      expect(output).toEqual({
        error: 'No Environment configured. Run `npx @florent-uzio/custody-mcp add-env <name>` to set one up.',
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
