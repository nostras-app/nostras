package main

import "net/http"

// securityHeadersCSP is shared by every HTML page this relay serves
// directly (landing, /why, /node, /wallet, /stats, /dashboard). All of
// them are self-contained documents — no external fonts/CDNs/scripts
// anywhere (confirmed by grepping every page.html for an external
// https:// resource load during the security review that flagged this
// gap: 2026-09-01), and every fetch() call in any of them is a relative,
// same-origin path — so 'self' plus 'unsafe-inline' (these pages use
// inline <style>/<script> blocks and inline style="" attributes
// throughout, not a nonce-based build step) is both safe and sufficient,
// not a placeholder that'll need loosening later.
const securityHeadersCSP = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'self'"

// withSecurityHeaders adds standard defense-in-depth headers to every
// HTML page response. app.nostras.app (the client, served by nginx)
// already carries a CSP from an earlier mixed-content fix (see CLAUDE.md,
// 2026-08-10) — this relay's own served pages never got the equivalent
// treatment until this same security review flagged the gap. Composes
// with wrapPageView/requireDashboardAuth at each call site rather than
// replacing either.
func withSecurityHeaders(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", securityHeadersCSP)
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// includeSubDomains is safe here: every subdomain of nostras.app
		// (app.nostras.app included) already redirects HTTP->HTTPS and
		// serves no plain-HTTP content — confirmed directly, not assumed,
		// during the same review (curl -I http://app.nostras.app/ -> 301).
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		next(w, r)
	}
}
