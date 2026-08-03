import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

const STORAGE_KEY = 'nostras:dev-signer-nsec'

/**
 * Temporary dev-only signer: generates a key and keeps it in localStorage,
 * unencrypted. This exists so the feed can be built and tested end to end.
 * It must be replaced by real bring-your-own-signer support (NIP-46/NIP-07)
 * before this app ever touches a real key.
 */
export function getDevSigner(): NDKPrivateKeySigner {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    return new NDKPrivateKeySigner(stored)
  }

  const signer = NDKPrivateKeySigner.generate()
  localStorage.setItem(STORAGE_KEY, signer.nsec)
  return signer
}
