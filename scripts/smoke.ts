// Manual end-to-end check against a real Custody instance (the devbox). Never run in CI: it proposes and approves
// a real Intent. It starts this server over stdio, as an MCP client would, with your own custody-mcp config.
//
//   npx tsx scripts/smoke.ts --env <name> --account <r…> --destination <r…> [--amount <drops>] [--approver <name>]
//
// --env       Environment that proposes, at Access level `approve` (it also tries to approve its own Intent).
// --account   XRPL address of a funded Custody account in that Environment's Default domain.
// --destination  XRPL address the test Payment goes to.
// --amount    Drops to send (default 1).
// --approver  Second Environment (another Custody user, Access level `approve`) used when self-approval is not allowed.
import { MCPClient } from '@mastra/mcp'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    env: { type: 'string' },
    account: { type: 'string' },
    destination: { type: 'string' },
    amount: { type: 'string', default: '1' },
    approver: { type: 'string' },
  },
})
if (args.env === undefined || args.account === undefined || args.destination === undefined) {
  console.error(
    'Usage: npx tsx scripts/smoke.ts --env <name> --account <r…> --destination <r…> [--amount <drops>] [--approver <name>]',
  )
  process.exit(2)
}
const { env: proposer, account, destination, amount, approver } = args

const terminal = createInterface({ input: process.stdin, output: process.stdout })

const client = new MCPClient({
  servers: {
    custody: {
      command: 'npx',
      args: ['tsx', path.join(import.meta.dirname, '../src/stdio.ts')],
      // The server reads your config file and Key references (Keychain, files, env vars) as it would from your client.
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      onToolError: 'return',
      // Approve asks for confirmation: answer it here, as a human would in their client.
      inputRequests: async request => {
        console.log(`\n${request.params.message}`)
        const answer = await terminal.question('Confirm? [y/N] ')
        return answer.trim().toLowerCase() === 'y' ? { action: 'accept', content: {} } : { action: 'decline' }
      },
    },
  },
})

const tools = await client.listTools()

/** Calls a tool and returns its output, or throws with the error the model would see. */
const call = async (toolId: string, input: object): Promise<Record<string, unknown>> => {
  const result = (await tools[`custody_${toolId}`].execute!(input, {})) as Record<string, unknown> & {
    isError?: boolean
    content?: { text: string }[]
  }
  if (!Array.isArray(result.content)) return result
  const text = result.content.map(item => item.text).join('\n')
  if (result.isError === true) {
    // Mastra wraps the tool's error in JSON; its message is what the model reads.
    let message = text
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text
    } catch {}
    throw new Error(`${toolId} failed: ${message}`)
  }
  return text === '' ? {} : JSON.parse(text)
}

const step = async (title: string, toolId: string, input: object) => {
  console.log(`\n== ${title} (${toolId})`)
  const output = await call(toolId, input)
  console.log(JSON.stringify(output, null, 2))
  return output
}

const environment = { environment: proposer }
const payment = {
  account,
  operation: { type: 'Payment', destination: { type: 'Address', address: destination }, amount },
}
const findings: string[] = []

try {
  const { backendVersion } = await step('Backend version', 'getBackendVersion', environment)
  findings.push(`Backend version: ${JSON.stringify(backendVersion)}`)

  await step('Environments', 'listEnvironments', {})
  await step('Who am I', 'getMe', environment)
  await step('Domains', 'listDomains', environment)
  await step('Accounts', 'listAccounts', { ...environment, limit: 5 })
  await step('Pending approvals', 'listPendingApprovals', { ...environment, limit: 5 })

  const dryRun = await step('Dry run', 'dryRunXrplIntent', { ...environment, ...payment })
  if (dryRun.success !== true) throw new Error('The Dry run failed, so the smoke test stops before proposing.')

  const { intentId } = await step('Propose', 'proposeXrplIntent', {
    ...environment,
    ...payment,
    description: `custody-mcp smoke test, ${new Date().toISOString()}`,
  })
  await step('Wait (expect: still awaiting approval)', 'waitForIntent', { ...environment, intentId, timeoutSeconds: 5 })

  // Self-approval: does the devbox let the proposer's approval count?
  let selfApproved = false
  try {
    const approval = await step('Approve as the proposer', 'approveIntent', { ...environment, intentId })
    if (approval.intentId === undefined) throw new Error('The confirmation was declined, so nothing was approved.')
    const { status } = await step('Wait after self-approval', 'waitForIntent', { ...environment, intentId })
    selfApproved = status !== 'Open'
    findings.push(`Self-approval: accepted by Custody; the Intent is ${status} afterwards.`)
  } catch (error) {
    findings.push(`Self-approval: refused (${(error as Error).message}).`)
  }

  if (!selfApproved) {
    if (approver === undefined) {
      findings.push('The Intent still needs another approver: run again with --approver <Environment of another user>.')
    } else {
      await step(`Approve as ${approver}`, 'approveIntent', { environment: approver, intentId })
      const { status } = await step('Wait after the second approval', 'waitForIntent', { ...environment, intentId })
      findings.push(`Approval by ${approver}: the Intent is ${status} afterwards.`)
    }
  }
} catch (error) {
  findings.push(`Stopped: ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  console.log(`\n== Findings\n${findings.map(line => `- ${line}`).join('\n')}`)
  terminal.close()
  await client.disconnect()
}
