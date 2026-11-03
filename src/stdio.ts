import { createCustodyMcpServer } from './server'

await createCustodyMcpServer({ env: process.env }).startStdio()
