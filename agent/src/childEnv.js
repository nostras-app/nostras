// Environment for the Claude Code processes this agent starts. The daemon
// loads agent.env, which holds the agent's private key and its own wallet
// connection; neither must reach a Claude session (DM coding tasks run with
// full autonomy). The evangelist's tool.js reads them itself from agent.env,
// so removing them here doesn't break anything.
const SECRET_VARS = ['NOSTR_AGENT_NSEC', 'AGENT_NWC_URI', 'NOSTRAS_DVM_NWC_URI']

export function claudeChildEnv() {
  const env = { ...process.env }
  for (const name of SECRET_VARS) delete env[name]
  return env
}
