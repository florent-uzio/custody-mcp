import { readFile } from 'node:fs/promises'

/** Fetches the private key a Key reference points at (ADR-0002). */
export const resolveKeyReference = async (keyReference: string, env: Record<string, string | undefined>) => {
  const [scheme, target] = splitOnce(keyReference, ':')
  if (scheme === 'env') {
    const key = env[target]
    if (!key) {
      throw new Error(`env var ${target} is not set`)
    }
    return key
  }
  if (scheme === 'file') {
    return readFile(target, 'utf8')
  }
  throw new Error(`unsupported Key reference "${keyReference}"`)
}

const splitOnce = (text: string, separator: string) => {
  const index = text.indexOf(separator)
  return index === -1 ? [text, ''] : [text.slice(0, index), text.slice(index + 1)]
}
