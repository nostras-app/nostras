import { readFileSync } from 'node:fs'

// Same minimal, dependency-free convention server/cmd/dvm/main.go's
// loadEnvFile already uses for nostras.env — no dotenv package added for
// one small config file. Missing file is not an error (first-boot case,
// before identity.js has generated anything to persist); existing
// process env vars always win over the file, so a real deployment can
// still override via the shell without editing agent.env.
export function loadEnvFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}
