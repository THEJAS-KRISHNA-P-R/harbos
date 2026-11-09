// Package auth implements passwordless mobile OTP issuance/verification and
// RFC 7519 HS256 JWT access tokens in pure Go (crypto/hmac + crypto/sha256).
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Role string

const (
	RoleSuperAdmin          Role = "SUPER_ADMIN"
	RoleHarbourAdmin        Role = "HARBOUR_ADMIN"
	RoleLicensedAuctioneer  Role = "LICENSED_AUCTIONEER"
	RoleFishermanBoatOwner  Role = "FISHERMAN_BOAT_OWNER"
	RoleWholesaleBuyer      Role = "WHOLESALE_BUYER"
	RoleWeighingOperator    Role = "WEIGHING_OPERATOR"
	RoleAccountant          Role = "ACCOUNTANT"
	RoleAuthorizedInspector Role = "AUTHORIZED_INSPECTOR"
)

type SessionClaims struct {
	Sub         string  `json:"sub"`
	TenantID    string  `json:"tenantId"`
	Role        Role    `json:"role"`
	FullName    string  `json:"fullName"`
	PhoneE164   string  `json:"phoneE164"`
	EntityRefID *string `json:"entityRefId"`
	Iss         string  `json:"iss"`
	Aud         string  `json:"aud"`
	Iat         int64   `json:"iat"`
	Exp         int64   `json:"exp"`
}

type otpEntry struct {
	code      string
	expiresAt time.Time
}

var (
	otpMu    sync.RWMutex
	otpStore = make(map[string]otpEntry)
)

// IssueOTPForPhone generates a 6-digit OTP code stored with a 5-minute TTL.
func IssueOTPForPhone(phoneE164 string) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(phoneE164), " ", "")
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", normalized, time.Now().Unix()/60)))
	num := (int(sum[0])<<16 | int(sum[1])<<8 | int(sum[2])) % 900000
	code := fmt.Sprintf("%06d", 100000+num)

	otpMu.Lock()
	otpStore[normalized] = otpEntry{
		code:      code,
		expiresAt: time.Now().Add(5 * time.Minute),
	}
	otpMu.Unlock()
	return code
}

// VerifyOTPForPhone validates the 6-digit OTP (or demo code 202100 when demoMode is enabled).
func VerifyOTPForPhone(phoneE164 string, otpCode string, demoMode bool) bool {
	normalized := strings.ReplaceAll(strings.TrimSpace(phoneE164), " ", "")
	code := strings.TrimSpace(otpCode)
	if demoMode && code == "202100" {
		return true
	}

	otpMu.Lock()
	defer otpMu.Unlock()
	entry, ok := otpStore[normalized]
	if !ok {
		return false
	}
	if time.Now().After(entry.expiresAt) {
		delete(otpStore, normalized)
		return false
	}
	if entry.code != code {
		return false
	}
	delete(otpStore, normalized)
	return true
}

// SignAccessJWT signs a 15-minute HS256 JWT token.
func SignAccessJWT(secret string, claims SessionClaims) (string, error) {
	now := time.Now().Unix()
	claims.Iss = "harbouros:identity:go"
	claims.Aud = "harbouros:api"
	claims.Iat = now
	claims.Exp = now + 15*60

	headerJSON := `{"alg":"HS256","typ":"JWT"}`
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	hEnc := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))
	pEnc := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := hEnc + "." + pEnc

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sigEnc := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return signingInput + "." + sigEnc, nil
}

// VerifyAccessJWT verifies the HS256 signature and expiration of a Bearer JWT.
func VerifyAccessJWT(secret string, token string) (SessionClaims, error) {
	var claims SessionClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims, errors.New("malformed JWT token")
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	expectedSig := mac.Sum(nil)

	actualSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(expectedSig, actualSig) {
		return claims, errors.New("invalid JWT signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims, errors.New("invalid JWT payload encoding")
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return claims, errors.New("invalid JWT claims JSON")
	}
	if time.Now().Unix() > claims.Exp {
		return claims, errors.New("JWT token expired")
	}
	return claims, nil
}

type ctxKey struct{}

func WithClaims(ctx context.Context, c SessionClaims) context.Context {
	return context.WithValue(ctx, ctxKey{}, c)
}

func GetClaims(ctx context.Context) (SessionClaims, bool) {
	c, ok := ctx.Value(ctxKey{}).(SessionClaims)
	return c, ok
}

// RequireAuth enforces JWT verification and optional role RBAC checks.
func RequireAuth(jwtSecret string, allowedRoles []Role, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"UNAUTHORIZED","message":"Missing Bearer access token"}}`))
			return
		}
		rawToken := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		claims, err := VerifyAccessJWT(jwtSecret, rawToken)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"UNAUTHORIZED","message":"Invalid or expired access token"}}`))
			return
		}

		if len(allowedRoles) > 0 {
			permitted := false
			for _, ar := range allowedRoles {
				if claims.Role == ar {
					permitted = true
					break
				}
			}
			if !permitted {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(fmt.Sprintf(
					`{"error":{"code":"FORBIDDEN","message":"Role %s is not permitted for this operation"}}`,
					claims.Role,
				)))
				return
			}
		}

		next(w, r.WithContext(WithClaims(r.Context(), claims)))
	}
}
