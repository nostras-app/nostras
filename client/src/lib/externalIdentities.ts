// NIP-39 External Identities. The current spec (re-verified directly
// before building this, not assumed from memory — an older draft of
// this NIP put "i" tags on kind:0 profile metadata, which is what this
// project's own compliance doc's original gap note assumed) actually
// stores them on a dedicated addressable-replaceable list event,
// kind:10011 — the same "list" event family this app already handles
// elsewhere (kind:10000 mute, kind:10002 relay list, kind:10003
// bookmarks), fetched-then-republished the same way.
//
// Only the four platforms the spec itself documents a verification
// method for are supported here — a "platform" field free-typed by the
// user would be real-world-common but unverifiable even in principle,
// and this app doesn't (yet) attempt independent verification anyway,
// so scoping to the spec's own known set keeps the identity list
// meaningful rather than an arbitrary label.
export const EXTERNAL_IDENTITY_PLATFORMS = [
  {
    id: 'github',
    label: 'GitHub',
    identityHint: 'username',
    proofHint: 'Gist ID',
    proofHelp: (identity: string) =>
      `Create a Gist containing "Verifying that I control the following Nostr public key: <npub>", then paste its ID here. Verifiable at gist.github.com/${identity || '<username>'}/<gist id>.`,
  },
  {
    id: 'twitter',
    label: 'Twitter / X',
    identityHint: 'username',
    proofHint: 'Tweet ID',
    proofHelp: (identity: string) =>
      `Post a tweet containing 'Verifying my account on nostr My Public Key: "<npub>"', then paste its ID here. Verifiable at twitter.com/${identity || '<username>'}/status/<tweet id>.`,
  },
  {
    id: 'mastodon',
    label: 'Mastodon',
    identityHint: 'instance/@username',
    proofHint: 'Post ID',
    proofHelp: (identity: string) =>
      `Post containing 'Verifying that I control the following Nostr public key: "<npub>"' on your instance, then paste the post ID here. Verifiable at ${identity || '<instance>/@<username>'}/<post id>.`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    identityHint: 'numeric user ID',
    proofHint: '<channel>/<message id>',
    proofHelp: () =>
      'Post the verification text in a public channel, then enter it as "<channel>/<message id>".',
  },
] as const

export type ExternalIdentityPlatform = (typeof EXTERNAL_IDENTITY_PLATFORMS)[number]['id']

export type ExternalIdentity = {
  platform: string
  identity: string
  proof: string
}

// Parses an "i" tag's ["i", "platform:identity", "proof"] shape.
export function parseExternalIdentityTag(tag: string[]): ExternalIdentity | null {
  if (tag[0] !== 'i' || !tag[1] || tag[2] === undefined) return null
  const sep = tag[1].indexOf(':')
  if (sep < 0) return null
  return {
    platform: tag[1].slice(0, sep),
    identity: tag[1].slice(sep + 1),
    proof: tag[2],
  }
}

export function externalIdentityTagKey(platform: string, identity: string): string {
  return `${platform}:${identity}`
}

// Where a reader can go to see the claimed identity itself (not the
// verification proof) — null for platforms with no browsable profile
// URL (Telegram's numeric IDs aren't a public page).
export function externalIdentityProfileUrl(platform: string, identity: string): string | null {
  switch (platform) {
    case 'github':
      return `https://github.com/${identity}`
    case 'twitter':
      return `https://twitter.com/${identity}`
    case 'mastodon':
      return `https://${identity}`
    default:
      return null
  }
}
