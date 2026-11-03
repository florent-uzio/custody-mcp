import { z } from 'zod'
import { domainIdFor, domainInput, nextCursor, pageInput, pageQuery, type DefineCustodyTool } from './custody-tool'

/** Read tools for what Custody moved and sent to the ledgers: transfers, transaction orders, transactions. */
export const createTransactionTools = (defineCustodyTool: DefineCustodyTool) => ({
  listTransfers: defineCustodyTool({
    id: 'listTransfers',
    description:
      'List the transfers (incoming and outgoing movements of assets) of a Custody domain, one page at a time. Values are in the smallest unit of the ticker.',
    input: {
      ...domainInput,
      accountId: z.string().optional().describe('Id of a Custody account, to list only its transfers.'),
      ...pageInput,
    },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { accountId } = args.input
      const page = await args.custody.transactions.transfers(
        { domainId },
        { ...pageQuery(args.input), ...(accountId === undefined ? {} : { accountId }) },
      )
      return {
        domainId,
        transfers: page.items.map(item => ({
          id: item.id,
          kind: item.kind,
          tickerId: item.tickerId,
          value: item.value,
          senders: item.senders,
          recipient: item.recipient,
          transactionId: item.transactionId,
          quarantineStatus: item.quarantineStatus,
          registeredAt: item.registeredAt,
        })),
        ...nextCursor(page),
      }
    },
  }),

  getTransfer: defineCustodyTool({
    id: 'getTransfer',
    description: 'Get one transfer of a Custody domain in full, with its senders, recipient and ledger data.',
    input: { ...domainInput, transferId: z.string().describe('Id of the transfer (see listTransfers).') },
    run: async args => {
      const domainId = await domainIdFor(args)
      const transfer = await args.custody.transactions.transfer({ domainId, transferId: args.input.transferId })
      return { domainId, transfer }
    },
  }),

  listTransactionOrders: defineCustodyTool({
    id: 'listTransactionOrders',
    description:
      'List the transaction orders (what an executed Intent asks Custody to send to a ledger) of a Custody domain, one page at a time. Follow a transaction order to its transaction with listTransactions.',
    input: {
      ...domainInput,
      intentId: z.string().optional().describe('Id of an Intent, to list only the transaction orders it produced.'),
      ...pageInput,
    },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { intentId } = args.input
      const page = await args.custody.transactions.orders(
        { domainId },
        { ...pageQuery(args.input), ...(intentId === undefined ? {} : { intentId }) },
      )
      return {
        domainId,
        transactionOrders: page.items.map(({ data }) => ({
          id: data.id,
          accountId: data.accountId,
          ledgerId: data.ledgerId,
          type: data.parameters.type,
          createdAt: data.metadata.createdAt,
        })),
        ...nextCursor(page),
      }
    },
  }),

  listTransactions: defineCustodyTool({
    id: 'listTransactions',
    description:
      'List the transactions (what Custody sent to a ledger) of a Custody domain, one page at a time, with their processing status in Custody and their status on the ledger. Pass a transactionOrderId to find the transaction a transaction order produced.',
    input: {
      ...domainInput,
      transactionOrderId: z
        .string()
        .optional()
        .describe('Id of a transaction order (see listTransactionOrders), to list only the transactions it produced.'),
      accountId: z.string().optional().describe('Id of a Custody account, to list only its transactions.'),
      ...pageInput,
    },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { transactionOrderId, accountId } = args.input
      const page = await args.custody.transactions.transactions(
        { domainId },
        {
          ...pageQuery(args.input),
          ...(transactionOrderId === undefined ? {} : { 'orderReference.Id': transactionOrderId }),
          ...(accountId === undefined ? {} : { accountId }),
        },
      )
      return {
        domainId,
        transactions: page.items.map(item => ({
          id: item.id,
          ledgerId: item.ledgerId,
          transactionOrderId: item.orderReference?.id,
          processingStatus: item.processing?.status,
          ledgerStatus: item.ledgerTransactionData?.ledgerStatus,
          ledgerTransactionId: item.ledgerTransactionData?.ledgerTransactionId,
          registeredAt: item.registeredAt,
        })),
        ...nextCursor(page),
      }
    },
  }),

  getTransaction: defineCustodyTool({
    id: 'getTransaction',
    description:
      'Get one transaction of a Custody domain in full: the order behind it, its processing status in Custody and its status on the ledger.',
    input: {
      ...domainInput,
      transactionId: z.string().describe('Id of the transaction (see listTransactions or listTransfers).'),
    },
    run: async args => {
      const domainId = await domainIdFor(args)
      const transaction = await args.custody.transactions.transaction({
        domainId,
        transactionId: args.input.transactionId,
      })
      return { domainId, transaction }
    },
  }),
})
