// Package domain implements pure integer paise/grams arithmetic, largest-remainder
// statutory commission apportionment (Kerala Act 16 of 2021 s.4(4) & s.4(5)),
// partial-box weight allocation, and canonical SHA-256 ledger hash chains.
// Zero float64 arithmetic is permitted on money, weight, or basis points.
package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
)

const (
	BpsDenominator  int64  = 10_000
	KeralaMaxCapBps int64  = 500
	GenesisPrevHash string = "0000000000000000000000000000000000000000000000000000000000000000"
)

type CommercialMode string

const (
	ModeFixedSaaSOnly          CommercialMode = "FIXED_SAAS_ONLY"
	ModeInstitutionalTechShare CommercialMode = "INSTITUTIONAL_TECH_SHARE"
	ModeHybrid                 CommercialMode = "HYBRID"
)

type CommissionPolicy struct {
	PolicyID                  string         `json:"policyId"`
	CommercialMode            CommercialMode `json:"commercialMode"`
	CommissionBps             int64          `json:"commissionBps"`
	AuctioneerShareBps        int64          `json:"auctioneerShareBps"`
	HmsShareBps               int64          `json:"hmsShareBps"`
	FisherBonusShareBps       int64          `json:"fisherBonusShareBps"`
	CoopShareBps              int64          `json:"coopShareBps"`
	InstitutionalTechShareBps int64          `json:"institutionalTechShareBps"`
	BuyerFeeBps               int64          `json:"buyerFeeBps"`
	GstRateBps                int64          `json:"gstRateBps"`
	LegalSignoffRef           string         `json:"legalSignoffRef,omitempty"`
	LegalSignoffDate          string         `json:"legalSignoffDate,omitempty"`
}

type SplitResult struct {
	HammerPaise           int64 `json:"hammerPaise"`
	TotalCommissionPaise  int64 `json:"totalCommissionPaise"`
	FishermanNetPaise     int64 `json:"fishermanNetPaise"`
	AuctioneerPaise       int64 `json:"auctioneerPaise"`
	HmsGrossPaise         int64 `json:"hmsGrossPaise"`
	HmsNetPaise           int64 `json:"hmsNetPaise"`
	BonusEscrowPaise      int64 `json:"bonusEscrowPaise"`
	CoopGrossPaise        int64 `json:"coopGrossPaise"`
	CoopNetPaise          int64 `json:"coopNetPaise"`
	HarbourosTechCutPaise int64 `json:"harbourosTechCutPaise"`
	BuyerFeePaise         int64 `json:"buyerFeePaise"`
	HarbourosRevenuePaise int64 `json:"harbourosRevenuePaise"`
	GstOnBuyerFeePaise    int64 `json:"gstOnBuyerFeePaise"`
	BuyerPayablePaise     int64 `json:"buyerPayablePaise"`
}

// ComputePriceTimesWeightPaise computes (grams * pricePerKgPaise + 500) / 1000
// using integer round-half-up division (§7 Price × Weight).
func ComputePriceTimesWeightPaise(grams int64, pricePerKgPaise int64) (int64, error) {
	if grams < 0 || pricePerKgPaise < 0 {
		return 0, errors.New("grams and pricePerKgPaise must be non-negative")
	}
	return (grams*pricePerKgPaise + 500) / 1000, nil
}

// AllocatePartialBoxGrams computes exact integer grams for k boxes out of remainingBoxes.
// The final allocation takes all remainingGrams so sum(allocations) == lotNetGrams (§7 Partial Boxes).
func AllocatePartialBoxGrams(boxesToAllocate int, remainingBoxes int, remainingGrams int64) (int64, error) {
	if boxesToAllocate <= 0 || remainingBoxes <= 0 || boxesToAllocate > remainingBoxes {
		return 0, fmt.Errorf("invalid box allocation: %d of %d remaining", boxesToAllocate, remainingBoxes)
	}
	if remainingGrams <= 0 {
		return 0, errors.New("remainingGrams must be positive")
	}
	if boxesToAllocate == remainingBoxes {
		return remainingGrams, nil
	}
	return (remainingGrams * int64(boxesToAllocate)) / int64(remainingBoxes), nil
}

type remainderBucket struct {
	index     int
	quotient  int64
	remainder int64
}

// ComputeStatutorySplit implements largest-remainder allocation across the four statutory
// pillars in deterministic tie-break order:
// 0: Auctioneer (20%), 1: HMS/Market (20%), 2: Fisher Bonus Escrow (40%), 3: Co-op/LSGI (20%).
func ComputeStatutorySplit(hammerPaise int64, p CommissionPolicy) (SplitResult, error) {
	if hammerPaise <= 0 {
		return SplitResult{}, errors.New("hammerPaise must be > 0")
	}
	if p.CommissionBps < 0 || p.CommissionBps > KeralaMaxCapBps {
		return SplitResult{}, fmt.Errorf("STATUTORY_CAP_EXCEEDED: commission_bps %d > %d", p.CommissionBps, KeralaMaxCapBps)
	}
	if p.AuctioneerShareBps+p.HmsShareBps+p.FisherBonusShareBps+p.CoopShareBps != BpsDenominator {
		return SplitResult{}, errors.New("recipient shares must sum to 10,000 bps")
	}
	if (p.CommercialMode == ModeInstitutionalTechShare || p.CommercialMode == ModeHybrid) &&
		(p.LegalSignoffRef == "" || p.LegalSignoffDate == "") {
		return SplitResult{}, errors.New("LEGAL_SIGNOFF_REQUIRED: Modes B and C require legal_signoff_ref and legal_signoff_date (s.4(6))")
	}

	totalCommission := (hammerPaise*p.CommissionBps + BpsDenominator/2) / BpsDenominator
	fishermanNet := hammerPaise - totalCommission

	weights := [4]int64{p.AuctioneerShareBps, p.HmsShareBps, p.FisherBonusShareBps, p.CoopShareBps}
	buckets := make([]remainderBucket, 4)
	var sumQuotients int64

	for i, w := range weights {
		num := totalCommission * w
		q := num / BpsDenominator
		r := num % BpsDenominator
		buckets[i] = remainderBucket{index: i, quotient: q, remainder: r}
		sumQuotients += q
	}

	leftover := totalCommission - sumQuotients
	order := []int{0, 1, 2, 3}
	sort.SliceStable(order, func(i, j int) bool {
		bi := buckets[order[i]]
		bj := buckets[order[j]]
		if bi.remainder != bj.remainder {
			return bi.remainder > bj.remainder
		}
		return bi.index < bj.index
	})

	for k := int64(0); k < leftover; k++ {
		buckets[order[k]].quotient++
	}

	auctioneer := buckets[0].quotient
	hmsGross := buckets[1].quotient
	bonusEscrow := buckets[2].quotient
	coopGross := buckets[3].quotient

	hmsNet := hmsGross
	coopNet := coopGross
	var techCut, buyerFee, gstOnBuyerFee int64

	if p.CommercialMode == ModeInstitutionalTechShare || p.CommercialMode == ModeHybrid {
		hmsTech := (hmsGross * p.InstitutionalTechShareBps) / BpsDenominator
		coopTech := (coopGross * p.InstitutionalTechShareBps) / BpsDenominator
		hmsNet = hmsGross - hmsTech
		coopNet = coopGross - coopTech
		techCut = hmsTech + coopTech
	}

	if p.CommercialMode == ModeHybrid {
		buyerFee = (hammerPaise*p.BuyerFeeBps + BpsDenominator/2) / BpsDenominator
		gstOnBuyerFee = (buyerFee*p.GstRateBps + BpsDenominator/2) / BpsDenominator
	}

	hosRevenue := techCut + buyerFee
	buyerPayable := hammerPaise + buyerFee + gstOnBuyerFee

	// Conservation invariant assertion (§2)
	sumFlows := fishermanNet + bonusEscrow + auctioneer + hmsNet + coopNet + hosRevenue + gstOnBuyerFee
	if sumFlows != buyerPayable {
		return SplitResult{}, fmt.Errorf("CONSERVATION_VIOLATION: sumFlows=%d != buyerPayable=%d", sumFlows, buyerPayable)
	}

	return SplitResult{
		HammerPaise:           hammerPaise,
		TotalCommissionPaise:  totalCommission,
		FishermanNetPaise:     fishermanNet,
		AuctioneerPaise:       auctioneer,
		HmsGrossPaise:         hmsGross,
		HmsNetPaise:           hmsNet,
		BonusEscrowPaise:      bonusEscrow,
		CoopGrossPaise:        coopGross,
		CoopNetPaise:          coopNet,
		HarbourosTechCutPaise: techCut,
		BuyerFeePaise:         buyerFee,
		HarbourosRevenuePaise: hosRevenue,
		GstOnBuyerFeePaise:    gstOnBuyerFee,
		BuyerPayablePaise:     buyerPayable,
	}, nil
}

type CanonicalHashInput struct {
	TenantID          string
	EntrySeq          int64
	PrevRowHash       string
	JournalID         string
	AccountID         string
	Direction         string
	AmountPaise       int64
	CreatedAtUtcIsoMs string
}

// FormatCanonicalPayload builds:
// tenant_id|entry_seq|prev_row_hash|journal_id|account_id|direction|amount_paise|created_at_utc_iso_ms
func FormatCanonicalPayload(in CanonicalHashInput) string {
	return fmt.Sprintf(
		"%s|%d|%s|%s|%s|%s|%d|%s",
		in.TenantID,
		in.EntrySeq,
		in.PrevRowHash,
		in.JournalID,
		in.AccountID,
		in.Direction,
		in.AmountPaise,
		in.CreatedAtUtcIsoMs,
	)
}

// ComputeCanonicalEntryHash returns hex(sha256(utf8(payload))).
func ComputeCanonicalEntryHash(in CanonicalHashInput) string {
	sum := sha256.Sum256([]byte(FormatCanonicalPayload(in)))
	return hex.EncodeToString(sum[:])
}

// SignLotQrHmac signs the dockside lot QR payload using HMAC-SHA256.
func SignLotQrHmac(secret string, tenantID string, lotCode string, vesselID string, netGrams int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	payload := fmt.Sprintf("%s|%s|%s|%d", tenantID, lotCode, vesselID, netGrams)
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}
