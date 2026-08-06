// The deploying commit's short git SHA, baked in at build time via
// client/Dockerfile's VITE_GIT_SHA build arg (Vite inlines
// import.meta.env.VITE_* into the bundle — not runtime-configurable).
// "dev" for a plain `npm run dev`/local build with no arg supplied.
export const CLIENT_VERSION = import.meta.env.VITE_GIT_SHA || 'dev'
