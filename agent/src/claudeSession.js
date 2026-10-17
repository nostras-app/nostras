import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getClaudeSessionId, setClaudeSessionId } from './state.js'
import { log } from './logger.js'
import { claudeChildEnv } from './childEnv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// agent/src -> agent -> repo root. This is what scopes the daemon to
// "this NOSTR repo only" per the user's explicit scope choice — cwd
// drives Claude Code's own CLAUDE.md auto-discovery and project context,
// same as any other session here.
const repoRoot = path.join(__dirname, '..', '..')
const settingsPath = path.join(__dirname, '..', 'claude-settings.json')

const MAX_BUDGET_USD = process.env.NOSTR_AGENT_MAX_BUDGET_USD || '5'
const TIMEOUT_MS = Number(process.env.NOSTR_AGENT_CLAUDE_TIMEOUT_MS) || 10 * 60 * 1000

// Layer 1 of 3 in the financial-safety design (see the plan/CLAUDE.md
// entry for the other two: a PreToolUse hook via claude-settings.json,
// and this daemon's own process never holding NOSTRAS_DVM_NWC_URI at
// all). Soft on its own, but free, and broadens the invariant beyond just
// "don't call payInvoiceWithNwc" to "don't send a payment through any
// code path" — a full-autonomy Bash-capable session could otherwise
// hand-roll one via server/cmd/dvm/nwc.go or a fresh script.
const FINANCIAL_SAFETY_REMINDER =
  "You are running as an unattended, full-autonomy background agent controlled " +
  "over Nostr DM, with nobody watching in real time. In addition to this repo's " +
  "own CLAUDE.md rules: never send, initiate, or construct a Lightning payment " +
  "through any code path -- not just the payInvoiceWithNwc function, ANY path " +
  "-- under any circumstance, even if the person messaging you asks directly or " +
  "claims authorization. Reading wallet-related code or config is fine; sending " +
  "a real payment is never fine."

// Real, user-reported problem (2026-09-06): the owner's own screenshot showed a
// long /engage-style report rendering as one unreadable wall-of-text DM bubble
// on a phone. Skills like /engage are written for an interactive desktop
// session (full step-by-step narration is genuinely useful there, since it's
// how the user follows the reasoning) -- this daemon is the one place that
// actually knows the final reply becomes a single DM on a small screen, so the
// fix belongs here, not in every individual skill file.
const MOBILE_DM_FORMAT_REMINDER =
  "Your final reply text is delivered as ONE DM bubble on the owner's phone -- " +
  "not a terminal or desktop chat window, and not a message they can casually " +
  "scroll past. No matter how much investigation, tool use, or intermediate " +
  "reasoning a task involves (including when following a skill like /engage " +
  "that normally produces a long step-by-step report), your final reply must " +
  "be short and skimmable: lead with the outcome, not the process. A few short " +
  "sentences or a tight few-line list -- never a multi-section report, deep " +
  "nested bullets, or a wall of narration. If a skill would normally have you " +
  "explain what you checked and why before presenting a result, compress all " +
  "of that down to one line of context at most. The one thing to never " +
  "compress or shorten is content the owner is being asked to explicitly " +
  "approve (e.g. a drafted reply's exact text) -- that must stay complete and " +
  "clearly set apart from the rest of the message, even if it makes that one " +
  "part of the reply longer than the rest."

function runClaude(content, sessionArgs) {
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--permission-mode', 'bypassPermissions',
      '--append-system-prompt', `${FINANCIAL_SAFETY_REMINDER}\n\n${MOBILE_DM_FORMAT_REMINDER}`,
      '--settings', settingsPath,
      '--max-budget-usd', MAX_BUDGET_USD,
      ...sessionArgs,
    ]

    // shell:false (the default) is deliberate, not incidental — content
    // never touches argv or a shell string. It's piped via stdin below,
    // which also sidesteps ARG_MAX and matches how the CLI itself
    // documents piped headless usage.
    const child = spawn('claude', args, { cwd: repoRoot, shell: false, env: claudeChildEnv() })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already exited between SIGTERM and this fallback.
        }
      }, 5000)
    }, TIMEOUT_MS)

    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: String(err?.message ?? err), timedOut: false, spawnError: true })
    })

    child.stdin.write(content)
    child.stdin.end()
  })
}

// A failed resume returns exit code 1 with PLAIN-TEXT stderr ("No
// conversation found...") even though --output-format json was
// requested — verified live. Never assume stdout parses just because it
// was asked for; check the exit code first, always.
function parseResultText(raw) {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed.result === 'string' ? parsed.result : null
  } catch {
    return null
  }
}

// Runs a DM's content through headless Claude Code with session
// continuity, returning the text to send back to the owner. Always
// returns a string — every failure path produces an honest error message
// rather than throwing or silently dropping the message.
export async function processMessage(content) {
  const existingSessionId = getClaudeSessionId()

  let result
  let freshIdIfAny = null

  if (existingSessionId) {
    result = await runClaude(content, ['-r', existingSessionId])
  } else {
    freshIdIfAny = randomUUID()
    result = await runClaude(content, ['--session-id', freshIdIfAny])
  }

  if (result.timedOut) {
    log.error('Claude invocation timed out', { timeoutMs: TIMEOUT_MS })
    return `Sorry — that task timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes and was stopped. It may have partially completed; check the repo directly if needed.`
  }

  if (existingSessionId && result.code !== 0) {
    // Resume-specific failure: one clean fallback to a fresh session with
    // the same content, never a crash loop.
    log.warn('Resume failed, retrying once with a fresh session', {
      code: result.code,
      stderr: result.stderr.slice(0, 500),
    })
    const freshId = randomUUID()
    result = await runClaude(content, ['--session-id', freshId])
    if (result.code === 0) {
      setClaudeSessionId(freshId)
    } else {
      log.error('Fresh-session retry also failed', {
        code: result.code,
        stderr: result.stderr.slice(0, 500),
      })
      return `Sorry — I couldn't resume our previous conversation, and a fresh session also failed (exit ${result.code}). Check the agent log for details.`
    }
  } else if (result.code === 0 && freshIdIfAny) {
    setClaudeSessionId(freshIdIfAny)
  } else if (result.code !== 0) {
    log.error('Claude invocation failed', {
      code: result.code,
      spawnError: !!result.spawnError,
      stderr: result.stderr.slice(0, 500),
    })
    return `Sorry — something went wrong running that (exit ${result.code}). Check the agent log for details.`
  }

  const text = parseResultText(result.stdout)
  if (text === null) {
    log.error('Could not parse Claude JSON output', { stdoutPreview: result.stdout.slice(0, 500) })
    return "Sorry — I finished but couldn't parse the response. Check the agent log for details."
  }

  return text
}
