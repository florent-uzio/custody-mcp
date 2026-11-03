// The macOS Keychain through the `security` tool. A thin adapter, checked by hand rather than in tests.
import { execFile } from 'node:child_process'

const security = (args: string[], input?: string) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile('security', args, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    )
    child.stdin?.end(input)
  })

// `security -i` reads its command from stdin, so the key never shows in the process list; `-X` takes
// it as hex, which needs no quoting. `-U` replaces an existing item.
export const setKeychainItem = async (service: string, account: string, secret: string) => {
  const hex = Buffer.from(secret, 'utf8').toString('hex')
  await security(['-i'], `add-generic-password -U -s "${service}" -a "${account}" -X ${hex}\n`)
}

export const getKeychainItem = async (service: string, account: string) => {
  const output = (await security(['find-generic-password', '-s', service, '-a', account, '-w'])).trim()
  // `-w` prints a secret with non-printable characters (a PEM's newlines) as hex.
  return /^([0-9a-f]{2})+$/.test(output) ? Buffer.from(output, 'hex').toString('utf8') : output
}

export const keychain = { set: setKeychainItem, get: getKeychainItem }
