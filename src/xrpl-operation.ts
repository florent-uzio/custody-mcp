import { z } from 'zod'

// The XRPL operations proposeXrplIntent supports, in Custody's `Core_XrplOperation_*` shapes. Checked here so a
// mistake is reported field by field before anything reaches Custody; the Dry run then checks the rest.

const destination = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('Address'), address: z.string() }),
    z.object({ type: z.literal('Account'), accountId: z.string() }),
    z.object({ type: z.literal('Endpoint'), endpointId: z.string() }),
  ])
  .describe('Who receives it: an XRPL address, a Custody account id, or a Custody endpoint id.')

const tokenIdentifier = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('MPTokenIssuanceId'), issuanceId: z.string() }),
    z.object({ type: z.literal('TickerId'), tickerId: z.string() }),
  ])
  .describe('The MPT: its issuance id, or the id of its Custody ticker (see listTickers).')

const amount = z.string().describe('Amount, as a string: drops for XRP, else the token amount.')

const payment = z.object({
  type: z.literal('Payment'),
  destination,
  amount,
  destinationTag: z.number().int().optional(),
  currency: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('Currency'), code: z.string(), issuer: z.string() }),
      z.object({ type: z.literal('MultiPurposeToken'), issuanceId: z.string() }),
      z.object({ type: z.literal('TickerId'), tickerId: z.string() }),
    ])
    .optional()
    .describe('What is paid: an IOU, an MPT, or a Custody ticker. Omit to pay XRP.'),
})

const trustSet = z.object({
  type: z.literal('TrustSet'),
  limitAmount: z.object({
    currency: z.discriminatedUnion('type', [
      z.object({ type: z.literal('Currency'), code: z.string(), issuer: z.string() }),
      z.object({ type: z.literal('TickerId'), tickerId: z.string() }),
    ]),
    value: z.string().describe('The trust line limit.'),
  }),
  flags: z.array(z.enum(['tfSetFreeze', 'tfClearFreeze', 'tfSetfAuth'])).default([]),
  enableRippling: z.boolean().optional(),
})

const mpTokenAuthorize = z.object({
  type: z.literal('MPTokenAuthorize'),
  tokenIdentifier,
  flags: z.array(z.enum(['tfMPTUnauthorize'])).default([]),
  holder: destination.optional().describe('The holder to authorize, when the issuer sends it.'),
})

const mpTokenIssuanceCreate = z.object({
  type: z.literal('MPTokenIssuanceCreate'),
  flags: z
    .array(
      z.enum([
        'tfMPTRequireAuth',
        'tfMPTCanClawback',
        'tfMPTCanTransfer',
        'tfMPTCanEscrow',
        'tfMPTCanLock',
        'tfMPTCanTrade',
        'tfMPTCanConfidentialAmount',
      ]),
    )
    .default([]),
  assetScale: z.number().int().optional(),
  transferFee: z.number().int().optional(),
  maximumAmount: z.string().optional(),
  metadata: z.object({ type: z.literal('HexEncodedMetadata'), value: z.string() }).optional(),
})

const mpTokenIssuanceDestroy = z.object({ type: z.literal('MPTokenIssuanceDestroy'), tokenIdentifier })

const mpTokenIssuanceSet = z.object({
  type: z.literal('MPTokenIssuanceSet'),
  tokenIdentifier,
  holder: destination.optional(),
  flags: z.array(z.enum(['tfMPTLock', 'tfMPTUnlock'])).default([]),
  mutableFlags: z.array(z.enum(['MPTSetCanConfidentialAmount'])).default([]),
  issuerEncryptionKey: z.string().optional().describe("The issuer's base64 ElGamal public key."),
  auditorEncryptionKey: z.string().optional().describe("The auditor's base64 ElGamal public key."),
})

const confidentialMptClawback = z.object({
  type: z.literal('ConfidentialMPTClawback'),
  tokenIdentifier,
  holder: destination,
})

const confidentialMptConvert = z.object({ type: z.literal('ConfidentialMPTConvert'), tokenIdentifier, amount })

const confidentialMptConvertBack = z.object({ type: z.literal('ConfidentialMPTConvertBack'), tokenIdentifier, amount })

const confidentialMptMergeInbox = z.object({ type: z.literal('ConfidentialMPTMergeInbox'), tokenIdentifier })

const confidentialMptSend = z.object({
  type: z.literal('ConfidentialMPTSend'),
  tokenIdentifier,
  destination,
  amount: amount.optional(),
})

/** The XRPL operation of a transaction order, in Custody's shape. */
export const xrplOperation = z
  .discriminatedUnion('type', [
    payment,
    trustSet,
    mpTokenAuthorize,
    mpTokenIssuanceCreate,
    mpTokenIssuanceDestroy,
    mpTokenIssuanceSet,
    confidentialMptClawback,
    confidentialMptConvert,
    confidentialMptConvertBack,
    confidentialMptMergeInbox,
    confidentialMptSend,
  ])
  .describe('The XRPL operation to propose, chosen by `type`.')
