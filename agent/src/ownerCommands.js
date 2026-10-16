import { isPaused, setPaused } from './state.js'
import { log } from './logger.js'

// Owner-only control commands. Returns a reply string when `content` is a
// command, or null when it should go to Claude as a normal task. The match
// is the whole message (trimmed, case-insensitive), so a task that merely
// mentions "stop" is never mistaken for the kill switch.
export function handleOwnerCommand(content) {
  const cmd = content.trim().toLowerCase()
  if (cmd === 'stop' || cmd === 'pause') {
    setPaused(true)
    log.info('Evangelist paused by owner')
    return 'Paused. I will not post, reply, react or zap until you send "resume". DM tasks still work.'
  }
  if (cmd === 'resume') {
    setPaused(false)
    log.info('Evangelist resumed by owner')
    return 'Resumed. The evangelist loop will run on its next scheduled slot.'
  }
  if (cmd === 'status') {
    return `Evangelist: ${isPaused() ? 'paused' : 'active'}.`
  }
  return null
}
