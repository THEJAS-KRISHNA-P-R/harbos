package domain

import "testing"

func TestGoldenVectorsSection2(t *testing.T) {
	const hammer = int64(10_000_000) // ₹1,00,000.00 = 10,000,000 paise

	// Mode A: FIXED_SAAS_ONLY
	resA, err := ComputeStatutorySplit(hammer, CommissionPolicy{
		PolicyID:                  "POL-A",
		CommercialMode:            ModeFixedSaaSOnly,
		CommissionBps:             500,
		AuctioneerShareBps:        2000,
		HmsShareBps:               2000,
		FisherBonusShareBps:       4000,
		CoopShareBps:              2000,
		InstitutionalTechShareBps: 2000,
		BuyerFeeBps:               100,
		GstRateBps:                1800,
	})
	if err != nil {
		t.Fatalf("Mode A error: %v", err)
	}
	if resA.FishermanNetPaise != 9_500_000 ||
		resA.BonusEscrowPaise != 200_000 ||
		resA.AuctioneerPaise != 100_000 ||
		resA.HmsNetPaise != 100_000 ||
		resA.CoopNetPaise != 100_000 ||
		resA.HarbourosRevenuePaise != 0 ||
		resA.BuyerPayablePaise != 10_000_000 {
		t.Fatalf("Mode A golden vector mismatch: %+v", resA)
	}

	// Mode B: INSTITUTIONAL_TECH_SHARE
	resB, err := ComputeStatutorySplit(hammer, CommissionPolicy{
		PolicyID:                  "POL-B",
		CommercialMode:            ModeInstitutionalTechShare,
		CommissionBps:             500,
		AuctioneerShareBps:        2000,
		HmsShareBps:               2000,
		FisherBonusShareBps:       4000,
		CoopShareBps:              2000,
		InstitutionalTechShareBps: 2000,
		BuyerFeeBps:               100,
		GstRateBps:                1800,
		LegalSignoffRef:           "ADV-KHC-2026-01",
		LegalSignoffDate:          "2026-01-15",
	})
	if err != nil {
		t.Fatalf("Mode B error: %v", err)
	}
	if resB.FishermanNetPaise != 9_500_000 ||
		resB.BonusEscrowPaise != 200_000 ||
		resB.AuctioneerPaise != 100_000 ||
		resB.HmsNetPaise != 80_000 ||
		resB.CoopNetPaise != 80_000 ||
		resB.HarbourosRevenuePaise != 40_000 ||
		resB.BuyerPayablePaise != 10_000_000 {
		t.Fatalf("Mode B golden vector mismatch: %+v", resB)
	}

	// Mode C: HYBRID
	resC, err := ComputeStatutorySplit(hammer, CommissionPolicy{
		PolicyID:                  "POL-C",
		CommercialMode:            ModeHybrid,
		CommissionBps:             500,
		AuctioneerShareBps:        2000,
		HmsShareBps:               2000,
		FisherBonusShareBps:       4000,
		CoopShareBps:              2000,
		InstitutionalTechShareBps: 2000,
		BuyerFeeBps:               100,
		GstRateBps:                1800,
		LegalSignoffRef:           "ADV-KHC-2026-01",
		LegalSignoffDate:          "2026-01-15",
	})
	if err != nil {
		t.Fatalf("Mode C error: %v", err)
	}
	if resC.FishermanNetPaise != 9_500_000 ||
		resC.BonusEscrowPaise != 200_000 ||
		resC.AuctioneerPaise != 100_000 ||
		resC.HmsNetPaise != 80_000 ||
		resC.CoopNetPaise != 80_000 ||
		resC.HarbourosRevenuePaise != 140_000 ||
		resC.GstOnBuyerFeePaise != 18_000 ||
		resC.BuyerPayablePaise != 10_118_000 {
		t.Fatalf("Mode C golden vector mismatch: %+v", resC)
	}
}
