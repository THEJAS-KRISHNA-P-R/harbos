package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"harbouros/backend-go/internal/auth"
	"harbouros/backend-go/internal/db"
)

var (
	validUtrRegex       = regexp.MustCompile(`^[A-Z0-9][A-Z0-9\-_/]{5,31}$`)
	placeholderUtrRegex = regexp.MustCompile(`^(?i)(0+|1+|X+|TEST.*|DUMMY.*|INVALID.*|NULL|NONE|NA)$`)
)

type cachedBulkReconcileResponse struct {
	expiresAt time.Time
	payload   map[string]any
}

var (
	reconcileIdemMu    sync.Mutex
	reconcileIdemCache = make(map[string]cachedBulkReconcileResponse, 128)
)

func validateAndNormalizeGoBankUtr(raw string) (string, bool, string) {
	cleaned := strings.ToUpper(strings.TrimSpace(raw))
	if cleaned == "" {
		return "", false, "Bank UTR reference is empty"
	}
	if len(cleaned) < 6 {
		return cleaned, false, fmt.Sprintf("Bank UTR must be at least 6 characters (received %d chars)", len(cleaned))
	}
	if len(cleaned) > 32 {
		return cleaned[:32], false, fmt.Sprintf("Bank UTR exceeds maximum 32-character nodal reference limit (received %d chars)", len(cleaned))
	}
	if !validUtrRegex.MatchString(cleaned) {
		return cleaned, false, "Bank UTR contains invalid characters (only A–Z, 0–9, -, _, / allowed)"
	}
	if placeholderUtrRegex.MatchString(cleaned) {
		return cleaned, false, "Placeholder or test UTR value rejected by statutory clearing guard"
	}
	return cleaned, true, "Valid nodal bank UTR reference"
}

func (s *Server) handleSingleBatchReconcile(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetClaims(r.Context())
	batchID := strings.TrimSpace(r.PathValue("batchId"))
	var body struct {
		BankUtr string `json:"bankUtr"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	utr, ok, reason := validateAndNormalizeGoBankUtr(body.BankUtr)
	if !ok {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", reason)
		return
	}
	nowIso := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	updRes, err := s.db.Query(
		r.Context(),
		`UPDATE ledger.payout_batches
		 SET status = 'RECONCILED_UTR', bank_utr = $1, reconciled_at = $2
		 WHERE tenant_id = $3 AND (UPPER(batch_id) = UPPER($4) OR UPPER(batch_code) = UPPER($4))
		 RETURNING batch_id, batch_code, status, bank_utr`,
		utr, nowIso, claims.TenantID, batchID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if len(updRes.Rows) == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Payout batch not found")
		return
	}
	row := updRes.Rows[0]
	s.scale.InvalidateTenant(claims.TenantID)
	writeJSON(w, http.StatusOK, map[string]any{
		"batchId":   db.AsString(row["batch_id"]),
		"batchCode": db.AsString(row["batch_code"]),
		"status":    db.AsString(row["status"]),
		"bankUtr":   db.AsString(row["bank_utr"]),
	})
}

func (s *Server) handleBulkBatchReconcile(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetClaims(r.Context())
	var body struct {
		SourceLabel             string           `json:"sourceLabel"`
		IdempotencyKey          string           `json:"idempotencyKey"`
		TotalRowsParsed         int              `json:"totalRowsParsed"`
		InvalidOrUnmatchedCount int              `json:"invalidOrUnmatchedCount"`
		InvalidItems            []map[string]any `json:"invalidItems"`
		Items                   []struct {
			BatchID string `json:"batchId"`
			BankUtr string `json:"bankUtr"`
		} `json:"items"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if len(body.Items) == 0 && len(body.InvalidItems) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "At least one mapped payout batch UTR row is required")
		return
	}

	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idemKey == "" {
		idemKey = strings.TrimSpace(body.IdempotencyKey)
	}
	cacheKey := ""
	if idemKey != "" {
		cacheKey = claims.TenantID + ":" + idemKey
		reconcileIdemMu.Lock()
		if entry, exists := reconcileIdemCache[cacheKey]; exists && time.Now().Before(entry.expiresAt) {
			replay := make(map[string]any, len(entry.payload)+1)
			for k, v := range entry.payload {
				replay[k] = v
			}
			replay["idempotentReplay"] = true
			reconcileIdemMu.Unlock()
			writeJSON(w, http.StatusOK, replay)
			return
		}
		reconcileIdemMu.Unlock()
	}

	ctx := r.Context()
	nowIso := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	reconciled := make([]map[string]any, 0, len(body.Items))
	invalidItems := make([]map[string]any, 0, len(body.InvalidItems)+4)
	for _, inv := range body.InvalidItems {
		invalidItems = append(invalidItems, inv)
	}

	seenBatches := make(map[string]bool, len(body.Items))
	seenUtrs := make(map[string]bool, len(body.Items))
	duplicatesSkipped := 0

	for _, item := range body.Items {
		batchRef := strings.TrimSpace(item.BatchID)
		utr, valid, reason := validateAndNormalizeGoBankUtr(item.BankUtr)
		if batchRef == "" {
			invalidItems = append(invalidItems, map[string]any{
				"batchCode": "MISSING_BATCH_REF",
				"batchId":   nil,
				"bankUtr":   utr,
				"status":    "UNMATCHED_BATCH",
				"reason":    "Missing payout batch reference in bulk reconciliation payload",
			})
			continue
		}
		if !valid {
			invalidItems = append(invalidItems, map[string]any{
				"batchCode": batchRef,
				"batchId":   batchRef,
				"bankUtr":   utr,
				"status":    "INVALID_UTR",
				"reason":    reason,
			})
			continue
		}
		batchKey := strings.ToUpper(batchRef)
		if seenBatches[batchKey] {
			duplicatesSkipped++
			invalidItems = append(invalidItems, map[string]any{
				"batchCode": batchRef,
				"batchId":   batchRef,
				"bankUtr":   utr,
				"status":    "INVALID_UTR",
				"reason":    fmt.Sprintf("Duplicate batch reference (%s) in the same bulk upload", batchRef),
			})
			continue
		}
		if seenUtrs[utr] {
			duplicatesSkipped++
			invalidItems = append(invalidItems, map[string]any{
				"batchCode": batchRef,
				"batchId":   batchRef,
				"bankUtr":   utr,
				"status":    "INVALID_UTR",
				"reason":    fmt.Sprintf("Duplicate Bank UTR (%s) assigned to multiple batches in upload", utr),
			})
			continue
		}
		seenBatches[batchKey] = true
		seenUtrs[utr] = true

		updRes, err := s.db.Query(
			ctx,
			`UPDATE ledger.payout_batches
			 SET status = 'RECONCILED_UTR', bank_utr = $1, reconciled_at = $2
			 WHERE tenant_id = $3 AND (UPPER(batch_id) = UPPER($4) OR UPPER(batch_code) = UPPER($4))
			 RETURNING batch_id, batch_code, status, bank_utr`,
			utr, nowIso, claims.TenantID, batchRef,
		)
		if err == nil && len(updRes.Rows) > 0 {
			row := updRes.Rows[0]
			reconciled = append(reconciled, map[string]any{
				"batchId":   db.AsString(row["batch_id"]),
				"batchCode": db.AsString(row["batch_code"]),
				"status":    db.AsString(row["status"]),
				"bankUtr":   db.AsString(row["bank_utr"]),
			})
		} else {
			invalidItems = append(invalidItems, map[string]any{
				"batchCode": batchRef,
				"batchId":   nil,
				"bankUtr":   utr,
				"status":    "UNMATCHED_BATCH",
				"reason":    fmt.Sprintf("No payout batch matched \"%s\" in tenant ledger", batchRef),
			})
		}
	}

	if len(reconciled) == 0 {
		msg := "No matching payout batches were found to reconcile"
		if len(invalidItems) > 0 {
			if rStr, ok := invalidItems[0]["reason"].(string); ok && rStr != "" {
				msg = rStr
			}
		}
		writeError(w, http.StatusUnprocessableEntity, "NO_MATCHING_BATCHES", msg)
		return
	}

	sourceLabel := strings.TrimSpace(body.SourceLabel)
	if sourceLabel == "" {
		sourceLabel = "Inline Bank UTR CSV"
	}
	invCount := len(invalidItems)
	if body.InvalidOrUnmatchedCount > invCount {
		invCount = body.InvalidOrUnmatchedCount
	}
	totalParsed := body.TotalRowsParsed
	if totalParsed < len(reconciled)+invCount {
		totalParsed = len(reconciled) + invCount
	}
	auditID := fmt.Sprintf("AUD-BULK-UTR-%d", time.Now().UnixMilli())

	detailsBytes, _ := json.Marshal(map[string]any{
		"actorName":               claims.FullName,
		"sourceLabel":             sourceLabel,
		"reconciledCount":         len(reconciled),
		"totalRowsParsed":         totalParsed,
		"invalidOrUnmatchedCount": invCount,
		"duplicatesSkipped":       duplicatesSkipped,
		"reconciled":              reconciled,
		"invalidItems":            invalidItems,
	})
	_, _ = s.db.Query(
		ctx,
		`INSERT INTO core.audit_logs (audit_id, tenant_id, actor_user_id, actor_role, action_code, target_type, target_id, details_json, created_at)
		 VALUES ($1, $2, $3, $4, 'PAYOUT_BATCH_BULK_UTR_RECONCILED', 'PAYOUT_BATCH', $5, $6, $7)`,
		auditID,
		claims.TenantID,
		claims.Sub,
		string(claims.Role),
		fmt.Sprintf("BULK-%d-BATCHES", len(reconciled)),
		string(detailsBytes),
		nowIso,
	)

	s.scale.InvalidateTenant(claims.TenantID)
	respPayload := map[string]any{
		"auditId":                 auditID,
		"timestampIso":            nowIso,
		"sourceLabel":             sourceLabel,
		"reconciledCount":         len(reconciled),
		"totalRowsParsed":         totalParsed,
		"invalidOrUnmatchedCount": invCount,
		"duplicatesSkipped":       duplicatesSkipped,
		"idempotentReplay":        false,
		"reconciled":              reconciled,
		"invalidItems":            invalidItems,
	}

	if cacheKey != "" {
		reconcileIdemMu.Lock()
		if len(reconcileIdemCache) >= 512 {
			reconcileIdemCache = make(map[string]cachedBulkReconcileResponse, 128)
		}
		reconcileIdemCache[cacheKey] = cachedBulkReconcileResponse{
			expiresAt: time.Now().Add(10 * time.Minute),
			payload:   respPayload,
		}
		reconcileIdemMu.Unlock()
	}

	writeJSON(w, http.StatusOK, respPayload)
}
