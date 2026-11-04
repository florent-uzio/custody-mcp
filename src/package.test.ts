// The publish guard: the package as npm would publish it installs on its own and starts as an MCP server.
import { MCPClient } from '@mastra/mcp'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import packageJson from '../package.json'

const root = path.join(__dirname, '..')
const work = mkdtempSync(path.join(tmpdir(), 'custody-mcp-package-'))
let client: MCPClient | undefined

afterAll(async () => {
  await client?.disconnect()
  rmSync(work, { recursive: true, force: true })
})

it('installs from its tarball and starts with no other packages', async () => {
  // dist/ is removed first so the tarball holds whatever packing builds, not a stale local bundle.
  rmSync(path.join(root, 'dist'), { recursive: true, force: true })
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8' }),
  ) as { filename: string }[]
  writeFileSync(path.join(work, 'package.json'), '{}')
  execFileSync('npm', ['install', '--offline', '--no-audit', '--no-fund', path.join(work, filename)], { cwd: work })

  client = new MCPClient({
    servers: {
      custody: {
        command: path.join(work, 'node_modules/.bin/custody-mcp'),
        args: [],
        env: { PATH: process.env.PATH ?? '', CUSTODY_MCP_CONFIG: path.join(work, 'no-config.json') },
      },
    },
  })
  const tools = await client.listTools()
  const version = await tools.custody_getMcpVersion.execute!({}, {})

  expect(version).toEqual({ name: '@florent-uzio/custody-mcp', version: packageJson.version })
}, 120_000)
