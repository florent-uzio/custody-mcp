import { z } from 'zod'
import { explorerUrlField } from './explorer-links'
import type { DefineCustodyTool } from './define'

/** Read tools for what Custody moved and sent to the ledgers: transfers, transaction orders, transactions. */
export const createTransactionTools = (defineCustodyTool: DefineCustodyTool) => ({
  listTransfers: defineCustodyTool({
    id: 'listTransfers',
    description:
      'List the transfers (incoming and outgoing movements of assets) of a Custody domain, one page at a time. Values are in the smallest unit of the ticker.',
    domain: true,
    paged: true,
    input: {
      accountId: z.string().optional().describe('Id of a Custody account, to list only its transfers.'),
    },
    run: async args => {
      const { domainId } = args
      const { accountId } = args.input
      const page = await args.custody.transactions.transfers(
        { domainId },
        { ...args.pageQuery, ...(accountId === undefined ? {} : { accountId }) },
      )
      return {
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
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  getTransfer: defineCustodyTool({
    id: 'getTransfer',
    description: 'Get one transfer of a Custody domain in full, with its senders, recipient and ledger data.',
    domain: true,
    input: { transferId: z.string().describe('Id of the transfer (see listTransfers).') },
    run: async args => {
      const { domainId } = args
      const transfer = await args.custody.transactions.transfer({ domainId, transferId: args.input.transferId })
      return { transfer }
    },
  }),

  listTransactionOrders: defineCustodyTool({
    id: 'listTransactionOrders',
    description:
      'List the transaction orders (what an executed Intent asks Custody to send to a ledger) of a Custody domain, one page at a time. Follow a transaction order to its transaction with listTransactions.',
    domain: true,
    paged: true,
    input: {
      intentId: z.string().optional().describe('Id of an Intent, to list only the transaction orders it produced.'),
    },
    run: async args => {
      const { domainId } = args
      const { intentId } = args.input
      const page = await args.custody.transactions.orders(
        { domainId },
        { ...args.pageQuery, ...(intentId === undefined ? {} : { intentId }) },
      )
      return {
        transactionOrders: page.items.map(({ data }) => ({
          id: data.id,
          accountId: data.accountId,
          ledgerId: data.ledgerId,
          type: data.parameters.type,
          createdAt: data.metadata.createdAt,
        })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  listTransactions: defineCustodyTool({
    id: 'listTransactions',
    description:
      'List the transactions (what Custody sent to a ledger) of a Custody domain, one page at a time, with their processing status in Custody and their status on the ledger. Pass a transactionOrderId to find the transaction a transaction order produced.',
    domain: true,
    paged: true,
    input: {
      transactionOrderId: z
        .string()
        .optional()
        .describe('Id of a transaction order (see listTransactionOrders), to list only the transactions it produced.'),
      accountId: z.string().optional().describe('Id of a Custody account, to list only its transactions.'),
    },
    run: async args => {
      const { domainId } = args
      const { transactionOrderId, accountId } = args.input
      const page = await args.custody.transactions.transactions(
        { domainId },
        {
          ...args.pageQuery,
          ...(transactionOrderId === undefined ? {} : { 'orderReference.Id': transactionOrderId }),
          ...(accountId === undefined ? {} : { accountId }),
        },
      )
      return {
        transactions: await Promise.all(
          page.items.map(async item => ({
            id: item.id,
            ledgerId: item.ledgerId,
            transactionOrderId: item.orderReference?.id,
            processingStatus: item.processing?.status,
            ledgerStatus: item.ledgerTransactionData?.ledgerStatus,
            ledgerTransactionId: item.ledgerTransactionData?.ledgerTransactionId,
            registeredAt: item.registeredAt,
            ...explorerUrlField(
              await args.explorer.transaction(item.ledgerId, item.ledgerTransactionData?.ledgerTransactionId),
            ),
          })),
        ),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  getTransaction: defineCustodyTool({
    id: 'getTransaction',
    description:
      'Get one transaction of a Custody domain in full: the order behind it, its processing status in Custody and its status on the ledger.',
    domain: true,
    input: {
      transactionId: z.string().describe('Id of the transaction (see listTransactions or listTransfers).'),
    },
    run: async args => {
      const { domainId } = args
      const transaction = await args.custody.transactions.transaction({
        domainId,
        transactionId: args.input.transactionId,
      })
      const explorerUrl = await args.explorer.transaction(
        transaction.ledgerId,
        transaction.ledgerTransactionData?.ledgerTransactionId,
      )
      return { transaction, ...explorerUrlField(explorerUrl) }
    },
  }),
})
