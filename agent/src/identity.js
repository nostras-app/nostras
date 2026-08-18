import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { log } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', 'agent.env')

// Missing file -> first boot, generate + persist a fresh identity (normal
// path). Corrupt/unparseable value -> hard startup failure, not a silent
// regenerate: a silently-minted new key would orphan the old, already-
// addressed one (the owner would keep DMing a pubkey nobody's listening
// on anymore), defeating the whole point of a stable identity.
export function loadOrCreateIdentity() {
  const existingNsec = process.env.NOSTR_AGENT_NSEC

  if (existingNsec) {
    let signer
    try {
      signer = new NDKPrivateKeySigner(existingNsec)
    } catch (e) {
      throw new Error(
        `NOSTR_AGENT_NSEC in agent.env is present but invalid — refusing to ` +
          `silently generate a new identity, since that would orphan the ` +
          `existing one. Fix or remove the value manually. (${e instanceof Error ? e.message : e})`,
      )
    }
    log.info('Loaded existing agent identity', { npub: signer.npub })
    return signer
  }

  const signer = NDKPrivateKeySigner.generate()
  const line = `NOSTR_AGENT_NSEC=${signer.nsec}\n`
  try {
    appendFileSync(envPath, line)
  } catch (e) {
    throw new Error(
      `Generated a new agent identity but could not persist it to ${envPath}: ` +
        `${e instanceof Error ? e.message : e}. Refusing to continue with an ` +
        `unpersisted identity — it would be lost on restart.`,
    )
  }
  process.env.NOSTR_AGENT_NSEC = signer.nsec
  log.info('Generated and persisted a new agent identity', {
    npub: signer.npub,
    envFile: envPath,
  })
  console.log(`\nNew nostr-agent identity created:\n  npub: ${signer.npub}\n` +
    `This is the pubkey you'll DM to talk to your agent. Run ` +
    `'npm run setup-identity' next to publish its profile and DM relay list.\n`)
  return signer
}

export function readAgentEnvRaw() {
  try {
    return readFileSync(envPath, 'utf8')
  } catch {
    return ''
  }
}
