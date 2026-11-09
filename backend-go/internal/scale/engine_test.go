package scale

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSingleflightCoalescesConcurrentReads(t *testing.T) {
	eng := NewEngine()
	var dbExecutions atomic.Int32

	const workers = 64
	var wg sync.WaitGroup
	wg.Add(workers)

	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			val, _, err := eng.CachedOrFetch("bootstrap:munambam-demo", func() (any, error) {
				dbExecutions.Add(1)
				time.Sleep(15 * time.Millisecond)
				return map[string]any{"ok": true}, nil
			})
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			m, ok := val.(map[string]any)
			if !ok || m["ok"] != true {
				t.Errorf("unexpected payload: %v", val)
			}
		}()
	}
	wg.Wait()

	if got := dbExecutions.Load(); got != 1 {
		t.Fatalf("expected Singleflight to coalesce 64 concurrent reads into 1 DB execution, got %d", got)
	}

	snap := eng.Snapshot()
	if snap.SingleflightCoalesced == 0 && snap.CacheHits == 0 {
		t.Fatalf("expected coalesced or cache hits > 0, got %+v", snap)
	}
}

func TestShardedCacheWriteThroughInvalidation(t *testing.T) {
	eng := NewEngine()
	_, status1, _ := eng.CachedOrFetch("bootstrap:munambam-demo", func() (any, error) {
		return "v1", nil
	})
	if status1 != "MISS" {
		t.Fatalf("expected first fetch to be MISS, got %s", status1)
	}

	val2, status2, _ := eng.CachedOrFetch("bootstrap:munambam-demo", func() (any, error) {
		return "v2", nil
	})
	if status2 != "HIT" || val2 != "v1" {
		t.Fatalf("expected second fetch to be HIT v1, got %s (%v)", status2, val2)
	}

	eng.InvalidateTenant("munambam-demo")

	val3, status3, _ := eng.CachedOrFetch("bootstrap:munambam-demo", func() (any, error) {
		return "v2", nil
	})
	if status3 != "MISS" || val3 != "v2" {
		t.Fatalf("expected post-invalidation fetch to be MISS v2, got %s (%v)", status3, val3)
	}
}
