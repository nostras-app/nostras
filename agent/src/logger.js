import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logPath = path.join(__dirname, '..', 'state', 'agent.log')

function write(level, msg, extra) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(extra !== undefined ? { extra } : {}),
  }
  const text = JSON.stringify(line)
  // Local, single-operator log — full detail (including message content)
  // is fine here since this is the owner's own private conversation on
  // their own machine, not shared/multi-tenant infra.
  if (!process.env.NOSTR_AGENT_QUIET) console.log(text)
  try {
    appendFileSync(logPath, text + '\n')
  } catch {
    // Never let a logging failure take down the daemon.
  }
}

export const log = {
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
}
