import { z } from 'zod'
import { domainIdFor, domainInput, type DefineCustodyTool } from './custody-tool'

// Both tools use Custody's internal API (/internal/v1/cmpt-cb-in), which a public API will replace.
const INTERNAL_API_NOTE =
  'Uses a Custody internal API that is not customer-facing and may change or be replaced by a public API.'

/** Read tools for the inbox (CB_IN) balance of a confidential MPT account. */
export const createDecryptionTools = (defineCustodyTool: DefineCustodyTool) => ({
  decryptConfidentialInboxBalance: defineCustodyTool({
    id: 'decryptConfidentialInboxBalance',
    description: `Decrypt the inbox (CB_IN) balance of a confidential MPT for a Custody account, and wait for the result. The inbox holds confidential amounts received but not yet merged into the spendable balance. A cmpt-… ticker in getAccountBalances is not the inbox: on a tested account it differed from the decrypted inbox, so it appears to be the spendable balance (inferred, not read directly). To check, compare it with this result. The issuanceId is the hex after "cmpt-" or "mpt-" in the ticker name (see listTickers). If still pending after the wait, follow it with getConfidentialInboxDecryption. ${INTERNAL_API_NOTE}`,
    input: {
      ...domainInput,
      accountId: z.string().describe('Id of the Custody account (see listAccounts).'),
      ledgerId: z.string().describe('Id of the ledger the MPT is on (see listLedgers).'),
      issuanceId: z
        .string()
        .describe(
          'MPT issuance id: the hex after "cmpt-" or "mpt-" in the ticker name, e.g. 002A08E0… (see listTickers).',
        ),
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
