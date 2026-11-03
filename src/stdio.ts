import { createInterface } from 'node:readline'
import { runCli } from './cli'
import { connectCustody } from './custody'
import { keychain } from './keychain'
import { createCustodyMcpServer } from './server'

// With no arguments the bin is the MCP server; with a subcommand it is the setup CLI.
const argv = process.argv.slice(2)
if (argv.length === 0) {
  await createCustodyMcpServer({ env: process.env }).startStdio()
} else {
  // Lines are read from an iterator, which buffers them, so answers piped in ahead of the questions are kept.
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const lines = prompt[Symbol.asyncIterator]()
  process.exitCode = await runCli(argv, {
    env: process.env,
    ask: async question => {
      process.stdout.write(question)
      const line = await lines.next()
      if (line.done) throw new Error('Input ended before add-env got all its answers.')
      return line.value
    },
    print: line => console.log(line),
    keychain,
    connect: connectCustody,
  }).finally(() => prompt.close())
}
