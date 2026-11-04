import { z } from 'zod'
import { domainIdFor, domainInput, type DefineCustodyTool } from './custody-tool'

// Both tools use Custody's internal API (/internal/v1/cmpt-cb-in), which a public API will replace.
const INTERNAL_API_NOTE =
  'Uses a Custody internal API that is not customer-facing and may change or be replaced by a public API.'

/** Read tools for the inbox (CB_IN) balance of a confidential MPT account. */
export const createDecryptionTools = (defineCustodyTool: DefineCustodyTool) => ({
  decryptConfidentialInboxBalance: defineCustodyTool({
    id: 'decryptConfidentialInboxBalance',
    description: `Decrypt the inbox (CB_IN) balance of a confidential MPT for a Custody account, and wait for the result. The spendable balance is not covered. If it is still pending after the wait, follow it with getConfidentialInboxDecryption. ${INTERNAL_API_NOTE}`,
    input: {
      ...domainInput,
      accountId: z.string().describe('Id of the Custody account (see listAccounts).'),
      ledgerId: z.string().describe('Id of the ledger the MPT is on (see listLedgers).'),
      issuanceId: z.string().describe('MPT issuance id (the hex part of the cmpt-… ticker name, see listTickers).'),
    },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { accountId, ledgerId, issuanceId } = args.input
      const { status, isTerminal, decryption } = await args.custody.internal.cbInDecryption.initiateAndWait({
        accountId,
        domainId,
        ledgerId,
        issuanceId,
      })
      return {
        domainId,
        accountId,
        issuanceId,
        requestId: decryption.id,
        status,
        isTerminal,
        decryptedAmount: decryption.decryptedAmount,
        error: decryption.error,
      }
    },
  }),

  getConfidentialInboxDecryption: defineCustodyTool({
    id: 'getConfidentialInboxDecryption',
    description: `Get the status of an inbox (CB_IN) balance decryption, with the decryptedAmount once it is Completed. ${INTERNAL_API_NOTE}`,
    input: { requestId: z.string().describe('The requestId returned by decryptConfidentialInboxBalance.') },
    run: async ({ custody, input }) => {
      const decryption = await custody.internal.cbInDecryption.getStatus({ requestId: input.requestId })
      return {
        requestId: decryption.id,
        status: decryption.status,
        decryptedAmount: decryption.decryptedAmount,
        error: decryption.error,
      }
    },
  }),
})
