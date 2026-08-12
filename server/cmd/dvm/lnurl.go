package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// LNURL-pay (LUD-06/LUD-16) resolution + LUD-21 settlement verification,
// used only by handleArticleUnlockJob to pay the article's author
// directly. This DVM performs the HTTP calls itself, server-side —
// deliberately, not trusting a client-submitted invoice — because that's
// what actually establishes an invoice genuinely came from the author's
// own declared lud16 endpoint. An earlier version of this feature tried
// to verify a client-submitted invoice's own bolt11 signature instead;
// that was found and proven (via a real forged-invoice test) to provide
// no actual security, since ECDSA signature *recovery* always succeeds
// for *some* key given any (signature, message) pair — it doesn't
// confirm the signer is who you expect unless you already know who to
// expect. Fetching the invoice here, over HTTPS, directly from the
// domain in the author's own published lud16, is what actually
// establishes provenance.
//
// LUD-21's `verify` URL is what lets this DVM confirm settlement of an
// invoice it has no NWC wallet connection to (unlike its own operator
// wallet, which it can lookup_invoice against directly) — see
// pollLnurlVerify. If the author's wallet doesn't support LUD-21, paid
// articles aren't available for that author yet; this is a real,
// explicit scope limit, not silently degraded.

const lnurlHTTPTimeout = 8 * time.Second

type lnurlPayParams struct {
	Callback    string `json:"callback"`
	MinSendable int64  `json:"minSendable"`
	MaxSendable int64  `json:"maxSendable"`
	Tag         string `json:"tag"`
}

type lnurlInvoiceResponse struct {
	PR     string `json:"pr"`
	Verify string `json:"verify"`
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type lnurlVerifyResponse struct {
	Status   string `json:"status"`
	Settled  bool   `json:"settled"`
	Preimage string `json:"preimage"`
	Reason   string `json:"reason"`
}

// resolveLud16 turns a lightning address ("name@domain.com") into its
// LNURL-pay endpoint, per LUD-16.
func resolveLud16(lud16 string) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(lud16), "@", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", errors.New("malformed lightning address")
	}
	return fmt.Sprintf("https://%s/.well-known/lnurlp/%s", parts[1], parts[0]), nil
}

func lnurlGet(ctx context.Context, rawURL string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, lnurlHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("request to %s returned status %d", rawURL, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// fetchLnurlPayParams fetches the author's LNURL-pay endpoint metadata
// (callback URL, sendable range).
func fetchLnurlPayParams(ctx context.Context, lud16 string) (*lnurlPayParams, error) {
	endpoint, err := resolveLud16(lud16)
	if err != nil {
		return nil, err
	}
	var params lnurlPayParams
	if err := lnurlGet(ctx, endpoint, &params); err != nil {
		return nil, fmt.Errorf("could not reach %s: %w", lud16, err)
	}
	if params.Tag != "payRequest" || params.Callback == "" {
		return nil, fmt.Errorf("%s is not a valid LNURL-pay address", lud16)
	}
	return &params, nil
}

// fetchLnurlInvoice requests a real invoice for msat from the author's
// own callback URL, and requires LUD-21 support (a "verify" URL in the
// response) — see the file comment for why.
func fetchLnurlInvoice(ctx context.Context, callback string, msat int64) (*lnurlInvoiceResponse, error) {
	u, err := url.Parse(callback)
	if err != nil {
		return nil, fmt.Errorf("invalid callback url: %w", err)
	}
	q := u.Query()
	q.Set("amount", fmt.Sprintf("%d", msat))
	u.RawQuery = q.Encode()

	var inv lnurlInvoiceResponse
	if err := lnurlGet(ctx, u.String(), &inv); err != nil {
		return nil, err
	}
	if inv.Status == "ERROR" {
		return nil, fmt.Errorf("lnurl error: %s", inv.Reason)
	}
	if inv.PR == "" {
		return nil, errors.New("no invoice returned")
	}
	if inv.Verify == "" {
		return nil, errors.New("this Lightning address's wallet does not support payment verification (LUD-21) yet — paid articles aren't available for this author right now")
	}
	return &inv, nil
}

// pollLnurlVerify polls a LUD-21 verify URL until it reports settled,
// or paymentWaitWindow elapses — same polling shape as requirePayment's
// own lookup_invoice loop, just over HTTP instead of NWC, since this
// DVM has no wallet connection to the author's own wallet.
func pollLnurlVerify(ctx context.Context, verifyURL string) (bool, error) {
	deadline := time.Now().Add(paymentWaitWindow)
	for time.Now().Before(deadline) {
		time.Sleep(paymentPollEvery)
		var v lnurlVerifyResponse
		if err := lnurlGet(ctx, verifyURL, &v); err != nil {
			continue // transient failure — keep polling until the deadline
		}
		if v.Status == "OK" && v.Settled {
			return true, nil
		}
	}
	return false, nil
}
