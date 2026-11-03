import { RippleCustody } from '@florent-uzio/custody'
import type { Environment } from './environments'

export type CustodyClient = RippleCustody

/** Makes the custody.js client for an Environment: the one dependency tests replace with a fake. */
export type ConnectCustody = (environment: Environment) => CustodyClient

export const connectCustody: ConnectCustody = environment =>
  new RippleCustody({
    authUrl: environment.authUrl,
    apiUrl: environment.apiUrl,
    publicKey: environment.publicKey,
    privateKey: environment.privateKey,
  })
