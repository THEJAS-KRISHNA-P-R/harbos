// Package auction implements the transactional statutory clearing engine,
// SHA-256 ledger verification, dual-key reversals, fencing-token leader leases,
// time-computed Dutch clock atomic claims, and append-only SHA-256 double-entry
// journal posting inside a single PostgreSQL transaction.
package auction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"harbouros/backend-go/internal/db"
	"harbouros/backend-go/internal/domain"
)

type LedgerVerification struct {
	Verified       bool    `json:"verified"`
	TenantID       string  `json:"tenantId"`
	EntryCount     int     `json:"entryCount"`
	LastEntrySeq   string  `json:"lastEntrySeq"`
	HeadHash       string  `json:"headHash"`
	FailedAtSeq    *string `json:"failedAtSeq,omitempty"`
	FailureReason  *string `json:"failureReason,omitempty"`
}

// VerifyTenantLedgerChain recomputes the canonical SHA-256 hash chain across all
// ledger.entries for a tenant and verifies balanced journals (SUM(D) == SUM(C)).
func VerifyTenantLedgerChain(ctx context.Context, database *db.DB, tenantID string) (LedgerVerification, error) {
	headRes, err := database.Query(
		ctx,
		`SELECT last_entry_seq::text AS last_entry_seq, last_row_hash FROM ledger.heads WHERE tenant_id = $1`,
		tenantID,
	)
	if err != nil {
		return LedgerVerification{}, err
	}
	if len(headRes.Rows) == 0 {
		return LedgerVerification{
			Verified:     true,
			TenantID:     tenantID,
			EntryCount:   0,
			LastEntrySeq: "0",
			HeadHash:     domain.GenesisPrevHash,
		}, nil
	}

	entriesRes, err := database.Query(
		ctx,
		`SELECT entry_seq::text AS entry_seq, journal_id, account_id, direction,
		        amount_paise::text AS amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms
		 FROM ledger.entries
		 WHERE tenant_id = $1
		 ORDER BY ledger.entries.entry_seq ASC`,
		tenantID,
	)
	if err != nil {
		return LedgerVerification{}, err
	}

	expectedPrev := domain.GenesisPrevHash
	var expectedSeq int64
	type jTotal struct {
		debit  int64
		credit int64
		count  int
	}
	jMap := make(map[string]*jTotal)

	for _, r := range entriesRes.Rows {
		expectedSeq++
		seq := db.AsInt64(r["entry_seq"])
		seqStr := fmt.Sprintf("%d", seq)
		prevHash := db.AsString(r["prev_row_hash"])
		rowHash := db.AsString(r["row_hash"])
		jrnID := db.AsString(r["journal_id"])
		accID := db.AsString(r["account_id"])
		dir := db.AsString(r["direction"])
		amt := db.AsInt64(r["amount_paise"])
		ts := db.AsString(r["created_at_utc_iso_ms"])

		if seq != expectedSeq {
			reason := fmt.Sprintf("Sequence gap: expected %d, got %d", expectedSeq, seq)
			return LedgerVerification{
				Verified:      false,
				TenantID:      tenantID,
				EntryCount:    len(entriesRes.Rows),
				LastEntrySeq:  seqStr,
				HeadHash:      rowHash,
				FailedAtSeq:   &seqStr,
				FailureReason: &reason,
			}, nil
		}

		if prevHash != expectedPrev {
			reason := fmt.Sprintf("Broken prev_row_hash link at seq %d", seq)
			return LedgerVerification{
				Verified:      false,
				TenantID:      tenantID,
				EntryCount:    len(entriesRes.Rows),
				LastEntrySeq:  seqStr,
				HeadHash:      rowHash,
				FailedAtSeq:   &seqStr,
				FailureReason: &reason,
			}, nil
		}

		recomputed := domain.ComputeCanonicalEntryHash(domain.CanonicalHashInput{
			TenantID:          tenantID,
			EntrySeq:          seq,
			PrevRowHash:       prevHash,
			JournalID:         jrnID,
			AccountID:         accID,
			Direction:         dir,
			AmountPaise:       amt,
			CreatedAtUtcIsoMs: ts,
		})
		if recomputed != rowHash {
			reason := fmt.Sprintf("SHA-256 row_hash mismatch at seq %d", seq)
			return LedgerVerification{
				Verified:      false,
				TenantID:      tenantID,
				EntryCount:    len(entriesRes.Rows),
				LastEntrySeq:  seqStr,
				HeadHash:      rowHash,
				FailedAtSeq:   &seqStr,
				FailureReason: &reason,
			}, nil
		}

		expectedPrev = rowHash
		jt := jMap[jrnID]
		if jt == nil {
			jt = &jTotal{}
			jMap[jrnID] = jt
		}
		jt.count++
		if dir == "D" {
			jt.debit += amt
		} else {
			jt.credit += amt
		}
	}

	for jrnID, jt := range jMap {
		if jt.count < 2 || jt.debit != jt.credit {
			reason := fmt.Sprintf("Unbalanced journal %s: D=%d C=%d", jrnID, jt.debit, jt.credit)
			return LedgerVerification{
				Verified:      false,
				TenantID:      tenantID,
				EntryCount:    len(entriesRes.Rows),
				LastEntrySeq:  fmt.Sprintf("%d", expectedSeq),
				HeadHash:      expectedPrev,
				FailureReason: &reason,
			}, nil
		}
	}

	return LedgerVerification{
		Verified:     true,
		TenantID:     tenantID,
		EntryCount:   len(entriesRes.Rows),
		LastEntrySeq: fmt.Sprintf("%d", expectedSeq),
		HeadHash:     expectedPrev,
	}, nil
}

type AllocationRequest struct {
	TenantID                string `json:"tenantId"`
	ActorUserID             string `json:"actorUserId"`
	ActorRole               string `json:"actorRole"`
	LotID                   string `json:"lotId"`
	SessionID               string `json:"sessionId"`
	AuctionMode             string `json:"auctionMode"`
	AuctioneerLicenceID     string `json:"auctioneerLicenceId"`
	BuyerID                 string `json:"buyerId"`
	BoxesAllocated          int    `json:"boxesAllocated"`
	PricePerKgPaise         int64  `json:"pricePerKgPaise"`
	FencingToken            int    `json:"fencingToken"`
	IdempotencyKey          string `json:"idempotencyKey"`
	GovernmentPermissionRef string `json:"governmentPermissionRef,omitempty"`
}

type AllocationResult struct {
	AllocationID          string `json:"allocationId"`
	JournalID             string `json:"journalId"`
	BoxesAllocated        int    `json:"boxesAllocated"`
	GramsAllocated        string `json:"gramsAllocated"`
	HammerPaise           string `json:"hammerPaise"`
	BuyerPayablePaise     string `json:"buyerPayablePaise"`
	FishermanNetPaise     string `json:"fishermanNetPaise"`
	BonusEscrowPaise      string `json:"bonusEscrowPaise"`
	AuctioneerPaise       string `json:"auctioneerPaise"`
	HmsNetPaise           string `json:"hmsNetPaise"`
	CoopNetPaise          string `json:"coopNetPaise"`
	HarbourosRevenuePaise string `json:"harbourosRevenuePaise"`
	GstPaise              string `json:"gstPaise"`
	FloorWarningTriggered bool   `json:"floorWarningTriggered"`
	ServerLatencyMs       int64  `json:"serverLatencyMs"`
	IdempotentReplay      bool   `json:"idempotentReplay"`
}

// AllocateLotSale enforces all 8 statutory checks (§7) and posts the balanced
// SHA-256 double-entry journal inside one PostgreSQL transaction.
func AllocateLotSale(ctx context.Context, database *db.DB, req AllocationRequest) (AllocationResult, error) {
	start := time.Now()
	var out AllocationResult

	err := database.WithTenantTx(ctx, req.TenantID, req.ActorUserID, req.ActorRole, func(tx db.Executor) error {
		// Check 7: Idempotency key replay
		idemRes, err := tx.Query(
			ctx,
			`SELECT allocation_id, journal_id, boxes_allocated, grams_allocated::text AS grams_allocated,
			        hammer_paise::text AS hammer_paise, buyer_payable_paise::text AS buyer_payable_paise,
			        fisherman_net_paise::text AS fisherman_net_paise, bonus_escrow_paise::text AS bonus_escrow_paise,
			        auctioneer_paise::text AS auctioneer_paise, hms_net_paise::text AS hms_net_paise,
			        coop_net_paise::text AS coop_net_paise, harbouros_revenue_paise::text AS harbouros_revenue_paise,
			        gst_paise::text AS gst_paise, floor_warning_triggered, server_latency_ms
			 FROM auction.sale_allocations
			 WHERE tenant_id = $1 AND idempotency_key = $2`,
			req.TenantID, req.IdempotencyKey,
		)
		if err != nil {
			return err
		}
		if len(idemRes.Rows) > 0 {
			r := idemRes.Rows[0]
			out = AllocationResult{
				AllocationID:          db.AsString(r["allocation_id"]),
				JournalID:             db.AsString(r["journal_id"]),
				BoxesAllocated:        db.AsInt(r["boxes_allocated"]),
				GramsAllocated:        db.AsString(r["grams_allocated"]),
				HammerPaise:           db.AsString(r["hammer_paise"]),
				BuyerPayablePaise:     db.AsString(r["buyer_payable_paise"]),
				FishermanNetPaise:     db.AsString(r["fisherman_net_paise"]),
				BonusEscrowPaise:      db.AsString(r["bonus_escrow_paise"]),
				AuctioneerPaise:       db.AsString(r["auctioneer_paise"]),
				HmsNetPaise:           db.AsString(r["hms_net_paise"]),
				CoopNetPaise:          db.AsString(r["coop_net_paise"]),
				HarbourosRevenuePaise: db.AsString(r["harbouros_revenue_paise"]),
				GstPaise:              db.AsString(r["gst_paise"]),
				FloorWarningTriggered: db.AsBool(r["floor_warning_triggered"]),
				ServerLatencyMs:       db.AsInt64(r["server_latency_ms"]),
				IdempotentReplay:      true,
			}
			return nil
		}

		// Check 8: Session Fencing Token
		sessRes, err := tx.Query(
			ctx,
			`SELECT fencing_token FROM auction.sessions WHERE tenant_id = $1 AND session_id = $2`,
			req.TenantID, req.SessionID,
		)
		if err != nil {
			return err
		}
		if len(sessRes.Rows) == 0 {
			return errors.New("SESSION_NOT_FOUND: Auction session does not exist for this tenant")
		}
		currentFencing := db.AsInt(sessRes.Rows[0]["fencing_token"])
		if req.FencingToken < currentFencing {
			return fmt.Errorf("STALE_FENCING_TOKEN: Tablet lease token %d is older than active leader token %d", req.FencingToken, currentFencing)
		}

		// Check 12: HMS_DIRECT_TAKEOVER requires Government permission reference (s.10 proviso)
		if req.AuctionMode == "HMS_DIRECT_TAKEOVER" && req.GovernmentPermissionRef == "" {
			return errors.New("GOVT_PERMISSION_REQUIRED: HMS_DIRECT_TAKEOVER requires a valid Government permission reference under Act 16 s.10 proviso")
		}

		// Lock Lot & Check 3 (s.21 Quality Inspection)
		lotRes, err := tx.Query(
			ctx,
			`SELECT lot_code, vessel_id, fisherman_id, species_id, available_boxes, available_grams::text AS available_grams,
			        inspection_grade, status
			 FROM auction.lots WHERE tenant_id = $1 AND lot_id = $2 FOR UPDATE`,
			req.TenantID, req.LotID,
		)
		if err != nil {
			return err
		}
		if len(lotRes.Rows) == 0 {
			return errors.New("LOT_NOT_FOUND: Lot does not exist")
		}
		lot := lotRes.Rows[0]
		lotCode := db.AsString(lot["lot_code"])
		vesselID := db.AsString(lot["vessel_id"])
		fishermanID := db.AsString(lot["fisherman_id"])
		speciesID := db.AsString(lot["species_id"])
		availBoxes := db.AsInt(lot["available_boxes"])
		availGrams := db.AsInt64(lot["available_grams"])
		grade := db.AsString(lot["inspection_grade"])
		lotStatus := db.AsString(lot["status"])

		if grade == "REJECTED_UNFIT" || lotStatus == "BLOCKED_UNFIT" {
			return errors.New("LOT_REJECTED_UNFIT_S21: Lot was graded REJECTED_UNFIT under Section 21 and cannot be auctioned")
		}
		if req.BoxesAllocated <= 0 || req.BoxesAllocated > availBoxes {
			return fmt.Errorf("LOT_OVERSELL_BLOCKED: Requested %d boxes but only %d boxes remain on %s", req.BoxesAllocated, availBoxes, lotCode)
		}

		// Check 1 & Check 2: Section 5 Licence Validity & Section 4(8) Society-Loan Deputed Rule
		licRes, err := tx.Query(
			ctx,
			`SELECT status, valid_from, valid_until, deputed_by_society_id, payable_account_id
			 FROM harbour.auctioneer_licences WHERE tenant_id = $1 AND licence_id = $2`,
			req.TenantID, req.AuctioneerLicenceID,
		)
		if err != nil {
			return err
		}
		if len(licRes.Rows) == 0 {
			return errors.New("LICENCE_NOT_FOUND_S5: Auctioneer licence does not belong to this harbour tenant (s.5(7))")
		}
		lic := licRes.Rows[0]
		licStatus := db.AsString(lic["status"])
		validFrom := db.AsString(lic["valid_from"])
		validUntil := db.AsString(lic["valid_until"])
		deputedSocID := db.AsString(lic["deputed_by_society_id"])
		licPayableAcc := db.AsString(lic["payable_account_id"])

		today := time.Now().UTC().Format("2006-01-02")
		if licStatus != "ACTIVE" || today < validFrom || today > validUntil {
			return fmt.Errorf("LICENCE_EXPIRED_S5: Auctioneer licence %s is %s (valid %s to %s) — blocked under Section 5", req.AuctioneerLicenceID, licStatus, validFrom, validUntil)
		}

		vesselRes, err := tx.Query(
			ctx,
			`SELECT vessel_name_en, has_active_society_loan, loan_coop_society_id
			 FROM harbour.vessels WHERE tenant_id = $1 AND vessel_id = $2`,
			req.TenantID, vesselID,
		)
		if err != nil || len(vesselRes.Rows) == 0 {
			return errors.New("VESSEL_NOT_FOUND: Vessel not found")
		}
		vessel := vesselRes.Rows[0]
		if db.AsBool(vessel["has_active_society_loan"]) {
			loanSocID := db.AsString(vessel["loan_coop_society_id"])
			if deputedSocID == "" || deputedSocID != loanSocID {
				return fmt.Errorf("SOCIETY_LOAN_MISMATCH_S4_8: Vessel %s has an active society loan (%s); Section 4(8) requires an auctioneer deputed by that cooperative society", db.AsString(vessel["vessel_name_en"]), loanSocID)
			}
		}

		// Check 4: Section 19 Floor Price Enforcement
		tenantRes, err := tx.Query(
			ctx,
			`SELECT floor_enforcement, active_policy_id, hms_account_id, coop_pool_account_id,
			        harbouros_revenue_account_id, gst_payable_account_id
			 FROM core.tenants WHERE tenant_id = $1`,
			req.TenantID,
		)
		if err != nil || len(tenantRes.Rows) == 0 {
			return errors.New("TENANT_NOT_FOUND")
		}
		ten := tenantRes.Rows[0]
		floorEnf := db.AsString(ten["floor_enforcement"])
		activePolicyID := db.AsString(ten["active_policy_id"])
		hmsAcc := db.AsString(ten["hms_account_id"])
		coopAcc := db.AsString(ten["coop_pool_account_id"])
		hosRevAcc := db.AsString(ten["harbouros_revenue_account_id"])
		gstAcc := db.AsString(ten["gst_payable_account_id"])

		specRes, err := tx.Query(
			ctx,
			`SELECT name_en, floor_price_paise_per_kg::text AS floor_price_paise_per_kg FROM harbour.species WHERE tenant_id = $1 AND species_id = $2`,
			req.TenantID, speciesID,
		)
		if err != nil || len(specRes.Rows) == 0 {
			return errors.New("SPECIES_NOT_FOUND")
		}
		floorPricePaise := db.AsInt64(specRes.Rows[0]["floor_price_paise_per_kg"])
		effectivePricePaise := req.PricePerKgPaise
		if req.AuctionMode == "COOP_PROCUREMENT" {
			effectivePricePaise = floorPricePaise
		}

		floorWarn := false
		if effectivePricePaise < floorPricePaise {
			if floorEnf == "BLOCK" {
				return fmt.Errorf("BELOW_FLOOR_PRICE_S19: Bid price (%d paise/kg) is below Section 19 Basic Floor Price (%d paise/kg) and tenant policy is BLOCK", effectivePricePaise, floorPricePaise)
			}
			if floorEnf == "WARN" {
				floorWarn = true
			}
		}

		// Check 5: Load Active Commission Policy & Compute Split
		polRes, err := tx.Query(
			ctx,
			`SELECT policy_id, commercial_mode, commission_bps, auctioneer_share_bps, hms_share_bps,
			        fisher_bonus_share_bps, coop_share_bps, institutional_tech_share_bps,
			        buyer_fee_bps, gst_rate_bps, legal_signoff_ref, legal_signoff_date
			 FROM core.commission_policies WHERE tenant_id = $1 AND policy_id = $2`,
			req.TenantID, activePolicyID,
		)
		if err != nil || len(polRes.Rows) == 0 {
			return errors.New("POLICY_NOT_FOUND")
		}
		pr := polRes.Rows[0]
		pol := domain.CommissionPolicy{
			PolicyID:                  db.AsString(pr["policy_id"]),
			CommercialMode:            domain.CommercialMode(db.AsString(pr["commercial_mode"])),
			CommissionBps:             db.AsInt64(pr["commission_bps"]),
			AuctioneerShareBps:        db.AsInt64(pr["auctioneer_share_bps"]),
			HmsShareBps:               db.AsInt64(pr["hms_share_bps"]),
			FisherBonusShareBps:       db.AsInt64(pr["fisher_bonus_share_bps"]),
			CoopShareBps:              db.AsInt64(pr["coop_share_bps"]),
			InstitutionalTechShareBps: db.AsInt64(pr["institutional_tech_share_bps"]),
			BuyerFeeBps:               db.AsInt64(pr["buyer_fee_bps"]),
			GstRateBps:                db.AsInt64(pr["gst_rate_bps"]),
			LegalSignoffRef:           db.AsString(pr["legal_signoff_ref"]),
			LegalSignoffDate:          db.AsString(pr["legal_signoff_date"]),
		}

		gramsAlloc, err := domain.AllocatePartialBoxGrams(req.BoxesAllocated, availBoxes, availGrams)
		if err != nil {
			return err
		}
		hammerPaise, err := domain.ComputePriceTimesWeightPaise(gramsAlloc, effectivePricePaise)
		if err != nil {
			return err
		}
		split, err := domain.ComputeStatutorySplit(hammerPaise, pol)
		if err != nil {
			return err
		}

		// Check 6: Lock Buyer Credit Row FOR UPDATE
		buyerRes, err := tx.Query(
			ctx,
			`SELECT buyer_name, escrow_balance_paise::text AS escrow_balance_paise,
			        approved_credit_paise::text AS approved_credit_paise,
			        unsettled_payables_paise::text AS unsettled_payables_paise,
			        active_holds_paise::text AS active_holds_paise,
			        receivable_account_id
			 FROM harbour.buyers WHERE tenant_id = $1 AND buyer_id = $2 FOR UPDATE`,
			req.TenantID, req.BuyerID,
		)
		if err != nil || len(buyerRes.Rows) == 0 {
			return errors.New("BUYER_NOT_FOUND")
		}
		br := buyerRes.Rows[0]
		buyerName := db.AsString(br["buyer_name"])
		buyerRecvAcc := db.AsString(br["receivable_account_id"])
		availLimit := db.AsInt64(br["escrow_balance_paise"]) +
			db.AsInt64(br["approved_credit_paise"]) -
			db.AsInt64(br["unsettled_payables_paise"]) -
			db.AsInt64(br["active_holds_paise"])

		if split.BuyerPayablePaise > availLimit {
			return fmt.Errorf("BUYER_CREDIT_EXCEEDED: Buyer %s available limit (%d paise) is insufficient for payable (%d paise)", buyerName, availLimit, split.BuyerPayablePaise)
		}

		// Decrement Lot Inventory & Increment Buyer Unsettled Payables
		nextBoxes := availBoxes - req.BoxesAllocated
		nextGrams := availGrams - gramsAlloc
		nextStatus := "PARTIALLY_SOLD"
		if nextBoxes == 0 {
			nextStatus = "FULLY_SOLD"
		}
		if _, err := tx.Query(
			ctx,
			`UPDATE auction.lots SET available_boxes = $1, available_grams = $2, status = $3 WHERE tenant_id = $4 AND lot_id = $5`,
			nextBoxes, fmt.Sprintf("%d", nextGrams), nextStatus, req.TenantID, req.LotID,
		); err != nil {
			return err
		}
		if _, err := tx.Query(
			ctx,
			`UPDATE harbour.buyers SET unsettled_payables_paise = unsettled_payables_paise + $1 WHERE tenant_id = $2 AND buyer_id = $3`,
			fmt.Sprintf("%d", split.BuyerPayablePaise), req.TenantID, req.BuyerID,
		); err != nil {
			return err
		}

		seqRes, err := tx.Query(
			ctx,
			`SELECT COALESCE(MAX(allocation_seq), 0) + 1 AS next_seq FROM auction.sale_allocations WHERE tenant_id = $1 AND lot_id = $2`,
			req.TenantID, req.LotID,
		)
		if err != nil {
			return err
		}
		allocSeq := db.AsInt(seqRes.Rows[0]["next_seq"])
		if allocSeq <= 0 {
			allocSeq = 1
		}

		allocID := fmt.Sprintf("ALLOC-%s-%d", lotCode, allocSeq)
		jrnID := fmt.Sprintf("JRN-%s", allocID)
		nowIso := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")

		// Lock Ledger Head FOR UPDATE & Post Double-Entry SHA-256 Chain
		headRes, err := tx.Query(
			ctx,
			`SELECT last_entry_seq::text AS last_entry_seq, last_row_hash FROM ledger.heads WHERE tenant_id = $1 FOR UPDATE`,
			req.TenantID,
		)
		if err != nil || len(headRes.Rows) == 0 {
			return errors.New("LEDGER_HEAD_NOT_FOUND")
		}
		lastSeq := db.AsInt64(headRes.Rows[0]["last_entry_seq"])
		prevHash := db.AsString(headRes.Rows[0]["last_row_hash"])

		fisherRes, err := tx.Query(
			ctx,
			`SELECT payable_account_id, bonus_escrow_account_id FROM harbour.fishermen WHERE tenant_id = $1 AND fisherman_id = $2`,
			req.TenantID, fishermanID,
		)
		if err != nil || len(fisherRes.Rows) == 0 {
			return errors.New("FISHERMAN_NOT_FOUND")
		}
		fisherPayableAcc := db.AsString(fisherRes.Rows[0]["payable_account_id"])
		fisherBonusAcc := db.AsString(fisherRes.Rows[0]["bonus_escrow_account_id"])

		if _, err := tx.Query(
			ctx,
			`INSERT INTO ledger.journals (journal_id, tenant_id, reference_type, reference_id, description, total_amount_paise, created_at)
			 VALUES ($1, $2, 'SALE_ALLOCATION', $3, $4, $5, $6)`,
			jrnID, req.TenantID, allocID,
			fmt.Sprintf("Lot %s sale (%d boxes, %d g) to %s", lotCode, req.BoxesAllocated, gramsAlloc, buyerName),
			fmt.Sprintf("%d", split.BuyerPayablePaise), nowIso,
		); err != nil {
			return err
		}

		type posting struct {
			accID string
			dir   string
			amt   int64
		}
		postings := []posting{
			{buyerRecvAcc, "D", split.BuyerPayablePaise},
			{fisherPayableAcc, "C", split.FishermanNetPaise},
			{fisherBonusAcc, "C", split.BonusEscrowPaise},
			{licPayableAcc, "C", split.AuctioneerPaise},
			{hmsAcc, "C", split.HmsNetPaise},
			{coopAcc, "C", split.CoopNetPaise},
		}
		if split.HarbourosRevenuePaise > 0 {
			postings = append(postings, posting{hosRevAcc, "C", split.HarbourosRevenuePaise})
		}
		if split.GstOnBuyerFeePaise > 0 {
			postings = append(postings, posting{gstAcc, "C", split.GstOnBuyerFeePaise})
		}

		for _, p := range postings {
			if p.amt <= 0 {
				continue
			}
			lastSeq++
			rowHash := domain.ComputeCanonicalEntryHash(domain.CanonicalHashInput{
				TenantID:          req.TenantID,
				EntrySeq:          lastSeq,
				PrevRowHash:       prevHash,
				JournalID:         jrnID,
				AccountID:         p.accID,
				Direction:         p.dir,
				AmountPaise:       p.amt,
				CreatedAtUtcIsoMs: nowIso,
			})
			if _, err := tx.Query(
				ctx,
				`INSERT INTO ledger.entries (entry_seq, tenant_id, journal_id, account_id, direction, amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				fmt.Sprintf("%d", lastSeq), req.TenantID, jrnID, p.accID, p.dir, fmt.Sprintf("%d", p.amt), prevHash, rowHash, nowIso,
			); err != nil {
				return err
			}
			if _, err := tx.Query(
				ctx,
				`UPDATE ledger.accounts SET balance_paise = balance_paise + $1 WHERE tenant_id = $2 AND account_id = $3`,
				fmt.Sprintf("%d", p.amt), req.TenantID, p.accID,
			); err != nil {
				return err
			}
			prevHash = rowHash
		}

		if _, err := tx.Query(
			ctx,
			`UPDATE ledger.heads SET last_entry_seq = $1, last_row_hash = $2 WHERE tenant_id = $3`,
			fmt.Sprintf("%d", lastSeq), prevHash, req.TenantID,
		); err != nil {
			return err
		}

		latencyMs := time.Since(start).Milliseconds()
		if latencyMs < 1 {
			latencyMs = 1
		}

		var govPerm any
		if req.GovernmentPermissionRef != "" {
			govPerm = req.GovernmentPermissionRef
		}

		if _, err := tx.Query(
			ctx,
			`INSERT INTO auction.sale_allocations (
				allocation_id, tenant_id, lot_id, allocation_seq, session_id, auction_mode,
				policy_id, auctioneer_licence_id, buyer_id, boxes_allocated, grams_allocated,
				price_per_kg_paise, hammer_paise, buyer_payable_paise, fisherman_net_paise,
				bonus_escrow_paise, auctioneer_paise, hms_net_paise, coop_net_paise,
				harbouros_revenue_paise, gst_paise, floor_warning_triggered,
				government_permission_ref, idempotency_key, fencing_token, journal_id,
				server_latency_ms, created_at
			) VALUES (
				$1, $2, $3, $4, $5, $6,
				$7, $8, $9, $10, $11,
				$12, $13, $14, $15,
				$16, $17, $18, $19,
				$20, $21, $22,
				$23, $24, $25, $26,
				$27, $28
			)`,
			allocID, req.TenantID, req.LotID, allocSeq, req.SessionID, req.AuctionMode,
			pol.PolicyID, req.AuctioneerLicenceID, req.BuyerID, req.BoxesAllocated, fmt.Sprintf("%d", gramsAlloc),
			fmt.Sprintf("%d", effectivePricePaise), fmt.Sprintf("%d", split.HammerPaise), fmt.Sprintf("%d", split.BuyerPayablePaise), fmt.Sprintf("%d", split.FishermanNetPaise),
			fmt.Sprintf("%d", split.BonusEscrowPaise), fmt.Sprintf("%d", split.AuctioneerPaise), fmt.Sprintf("%d", split.HmsNetPaise), fmt.Sprintf("%d", split.CoopNetPaise),
			fmt.Sprintf("%d", split.HarbourosRevenuePaise), fmt.Sprintf("%d", split.GstOnBuyerFeePaise), floorWarn,
			govPerm, req.IdempotencyKey, req.FencingToken, jrnID,
			latencyMs, nowIso,
		); err != nil {
			return err
		}

		auditDetails, _ := json.Marshal(map[string]any{
			"lotId":        req.LotID,
			"buyerId":      req.BuyerID,
			"boxes":        req.BoxesAllocated,
			"hammerPaise":  fmt.Sprintf("%d", split.HammerPaise),
			"floorWarning": floorWarn,
			"engine":       "go1.23",
		})
		_, _ = tx.Query(
			ctx,
			`INSERT INTO core.audit_logs (audit_id, tenant_id, actor_user_id, actor_role, action_code, target_type, target_id, details_json, created_at)
			 VALUES ($1, $2, $3, $4, 'LOT_ALLOCATED', 'SALE_ALLOCATION', $5, $6, $7)`,
			fmt.Sprintf("AUD-%s", allocID), req.TenantID, req.ActorUserID, req.ActorRole, allocID, string(auditDetails), nowIso,
		)

		out = AllocationResult{
			AllocationID:          allocID,
			JournalID:             jrnID,
			BoxesAllocated:        req.BoxesAllocated,
			GramsAllocated:        fmt.Sprintf("%d", gramsAlloc),
			HammerPaise:           fmt.Sprintf("%d", split.HammerPaise),
			BuyerPayablePaise:     fmt.Sprintf("%d", split.BuyerPayablePaise),
			FishermanNetPaise:     fmt.Sprintf("%d", split.FishermanNetPaise),
			BonusEscrowPaise:      fmt.Sprintf("%d", split.BonusEscrowPaise),
			AuctioneerPaise:       fmt.Sprintf("%d", split.AuctioneerPaise),
			HmsNetPaise:           fmt.Sprintf("%d", split.HmsNetPaise),
			CoopNetPaise:          fmt.Sprintf("%d", split.CoopNetPaise),
			HarbourosRevenuePaise: fmt.Sprintf("%d", split.HarbourosRevenuePaise),
			GstPaise:              fmt.Sprintf("%d", split.GstOnBuyerFeePaise),
			FloorWarningTriggered: floorWarn,
			ServerLatencyMs:       latencyMs,
			IdempotentReplay:      false,
		}
		return nil
	})

	return out, err
}

// ExecuteDualKeyReversal enforces two distinct authorizing users (Accountant + Harbour Admin)
// and posts a compensating SHA-256 hash-chained journal (§7 Reversals).
func ExecuteDualKeyReversal(
	ctx context.Context,
	database *db.DB,
	tenantID string,
	reversalID string,
	approverUserID string,
	approverName string,
) (string, error) {
	var compJrnID string
	err := database.WithTenantTx(ctx, tenantID, approverUserID, "HARBOUR_ADMIN", func(tx db.Executor) error {
		revRes, err := tx.Query(
			ctx,
			`SELECT reversal_id, original_journal_id, reason_note, requested_by_user_id, status
			 FROM ledger.reversal_requests WHERE tenant_id = $1 AND reversal_id = $2 FOR UPDATE`,
			tenantID, reversalID,
		)
		if err != nil || len(revRes.Rows) == 0 {
			return errors.New("REVERSAL_NOT_FOUND")
		}
		rev := revRes.Rows[0]
		if db.AsString(rev["status"]) == "EXECUTED" {
			return errors.New("ALREADY_EXECUTED")
		}
		reqBy := db.AsString(rev["requested_by_user_id"])
		if reqBy == approverUserID {
			return errors.New("DUAL_KEY_VIOLATION: Approver must be a different user than the requester (Accountant + Harbour Admin required)")
		}

		origJrnID := db.AsString(rev["original_journal_id"])
		reasonNote := db.AsString(rev["reason_note"])

		origEntries, err := tx.Query(
			ctx,
			`SELECT account_id, direction, amount_paise::text AS amount_paise
			 FROM ledger.entries WHERE tenant_id = $1 AND journal_id = $2 ORDER BY entry_seq ASC`,
			tenantID, origJrnID,
		)
		if err != nil || len(origEntries.Rows) == 0 {
			return errors.New("ORIGINAL_JOURNAL_EMPTY")
		}

		headRes, err := tx.Query(
			ctx,
			`SELECT last_entry_seq::text AS last_entry_seq, last_row_hash FROM ledger.heads WHERE tenant_id = $1 FOR UPDATE`,
			tenantID,
		)
		if err != nil || len(headRes.Rows) == 0 {
			return errors.New("LEDGER_HEAD_NOT_FOUND")
		}
		lastSeq := db.AsInt64(headRes.Rows[0]["last_entry_seq"])
		prevHash := db.AsString(headRes.Rows[0]["last_row_hash"])

		var totalDebits int64
		for _, e := range origEntries.Rows {
			if db.AsString(e["direction"]) == "D" {
				totalDebits += db.AsInt64(e["amount_paise"])
			}
		}

		compJrnID = fmt.Sprintf("JRN-REV-%s", reversalID)
		nowIso := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")

		if _, err := tx.Query(
			ctx,
			`INSERT INTO ledger.journals (
				journal_id, tenant_id, reference_type, reference_id, description,
				reverses_journal_id, authorized_by_user_1, authorized_by_user_2,
				reason_note, total_amount_paise, created_at
			) VALUES ($1, $2, 'REVERSAL', $3, $4, $5, $6, $7, $8, $9, $10)`,
			compJrnID, tenantID, reversalID,
			fmt.Sprintf("Compensating reversal of %s: %s", origJrnID, reasonNote),
			origJrnID, reqBy, approverUserID, reasonNote,
			fmt.Sprintf("%d", totalDebits), nowIso,
		); err != nil {
			return err
		}

		for _, orig := range origEntries.Rows {
			lastSeq++
			accID := db.AsString(orig["account_id"])
			origDir := db.AsString(orig["direction"])
			amt := db.AsInt64(orig["amount_paise"])
			flipped := "D"
			if origDir == "D" {
				flipped = "C"
			}

			rowHash := domain.ComputeCanonicalEntryHash(domain.CanonicalHashInput{
				TenantID:          tenantID,
				EntrySeq:          lastSeq,
				PrevRowHash:       prevHash,
				JournalID:         compJrnID,
				AccountID:         accID,
				Direction:         flipped,
				AmountPaise:       amt,
				CreatedAtUtcIsoMs: nowIso,
			})
			if _, err := tx.Query(
				ctx,
				`INSERT INTO ledger.entries (
					entry_seq, tenant_id, journal_id, account_id, direction,
					amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				fmt.Sprintf("%d", lastSeq), tenantID, compJrnID, accID, flipped, fmt.Sprintf("%d", amt), prevHash, rowHash, nowIso,
			); err != nil {
				return err
			}
			prevHash = rowHash
		}

		if _, err := tx.Query(
			ctx,
			`UPDATE ledger.heads SET last_entry_seq = $1, last_row_hash = $2 WHERE tenant_id = $3`,
			fmt.Sprintf("%d", lastSeq), prevHash, tenantID,
		); err != nil {
			return err
		}

		_, err = tx.Query(
			ctx,
			`UPDATE ledger.reversal_requests
			 SET approved_by_user_id = $1, approved_by_name = $2, compensating_journal_id = $3, status = 'EXECUTED'
			 WHERE tenant_id = $4 AND reversal_id = $5`,
			approverUserID, approverName, compJrnID, tenantID, reversalID,
		)
		return err
	})
	return compJrnID, err
}

// SSEHub manages real-time Server-Sent Events subscribers per auction session (§5 ADR-005).
type SSEHub struct {
	mu      sync.RWMutex
	clients map[string]map[chan string]struct{}
}

func NewSSEHub() *SSEHub {
	return &SSEHub{clients: make(map[string]map[chan string]struct{})}
}

func (h *SSEHub) Subscribe(sessionID string) (chan string, func()) {
	ch := make(chan string, 16)
	h.mu.Lock()
	if h.clients[sessionID] == nil {
		h.clients[sessionID] = make(map[chan string]struct{})
	}
	h.clients[sessionID][ch] = struct{}{}
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		delete(h.clients[sessionID], ch)
		close(ch)
		h.mu.Unlock()
	}
	return ch, unsubscribe
}

func (h *SSEHub) Broadcast(sessionID string, eventJSON string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients[sessionID] {
		select {
		case ch <- eventJSON:
		default:
		}
	}
}
