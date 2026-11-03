import { MCPClient } from '@mastra/mcp'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'

const client = new MCPClient({
  servers: {
    custody: {
      command: 'npx',
      args: ['tsx', path.join(__dirname, 'stdio.ts')],
      env: { PATH: process.env.PATH ?? '' },
    },
  },
})

afterAll(() => client.disconnect())

it('serves the tools over stdio', async () => {
  const tools = await client.listTools()

  expect(Object.keys(tools)).toEqual(expect.arrayContaining(['custody_getMcpVersion', 'custody_getMe']))
}, 60_000)
