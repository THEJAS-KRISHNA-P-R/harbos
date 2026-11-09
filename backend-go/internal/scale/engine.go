// Package scale provides the high-traffic concurrency, caching, singleflight
// request coalescing, token-bucket rate limiting, bulkhead load shedding,
// pooled gzip compression, and sub-microsecond latency telemetry engine for the
// HarbourOS Go 1.23 backend.
package scale

import (
	"compress/gzip"
	"io"
	"math"
	"net"
	"net/http"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	cacheShardCount   = 32
	latencyRingSize   = 2048
	defaultCacheTTL   = 5 * time.Second
	defaultReadSlots  = 512
	defaultWriteSlots = 128
)

type cacheEntry struct {
	value     any
	expiresAt int64 // UnixNano
}

type cacheShard struct {
	mu    sync.RWMutex
	items map[string]cacheEntry
}

// ShardedCache is a 32-shard concurrent in-memory TTL cache with zero global lock contention.
type ShardedCache struct {
	shards [cacheShardCount]cacheShard
	ttl    time.Duration
}

func NewShardedCache(ttl time.Duration) *ShardedCache {
	if ttl <= 0 {
		ttl = defaultCacheTTL
	}
	c := &ShardedCache{ttl: ttl}
	for i := 0; i < cacheShardCount; i++ {
		c.shards[i].items = make(map[string]cacheEntry, 32)
	}
	return c
}

func fnv32a(key string) uint32 {
	var hash uint32 = 2166136261
	for i := 0; i < len(key); i++ {
		hash ^= uint32(key[i])
		hash *= 16777619
	}
	return hash
}

func (c *ShardedCache) shardFor(key string) *cacheShard {
	return &c.shards[fnv32a(key)%cacheShardCount]
}

func (c *ShardedCache) Get(key string) (any, bool) {
	sh := c.shardFor(key)
	sh.mu.RLock()
	ent, ok := sh.items[key]
	sh.mu.RUnlock()
	if !ok {
		return nil, false
	}
	if time.Now().UnixNano() > ent.expiresAt {
		return nil, false
	}
	return ent.value, true
}

func (c *ShardedCache) Set(key string, val any) {
	sh := c.shardFor(key)
	exp := time.Now().Add(c.ttl).UnixNano()
	sh.mu.Lock()
	sh.items[key] = cacheEntry{
		value:     val,
		expiresAt: exp,
	}
	sh.mu.Unlock()
}

// InvalidatePrefix evicts all cached entries matching a prefix (e.g. tenant ID) on write mutations.
func (c *ShardedCache) InvalidatePrefix(prefix string) {
	for i := 0; i < cacheShardCount; i++ {
		sh := &c.shards[i]
		sh.mu.Lock()
		for k := range sh.items {
			if strings.HasPrefix(k, prefix) || strings.Contains(k, prefix) {
				delete(sh.items, k)
			}
		}
		sh.mu.Unlock()
	}
}

func (c *ShardedCache) InvalidateAll() {
	for i := 0; i < cacheShardCount; i++ {
		sh := &c.shards[i]
		sh.mu.Lock()
		sh.items = make(map[string]cacheEntry, 32)
		sh.mu.Unlock()
	}
}

func (c *ShardedCache) ActiveEntryCount() int {
	now := time.Now().UnixNano()
	total := 0
	for i := 0; i < cacheShardCount; i++ {
		sh := &c.shards[i]
		sh.mu.RLock()
		for _, ent := range sh.items {
			if ent.expiresAt > now {
				total++
			}
		}
		sh.mu.RUnlock()
	}
	return total
}

// Singleflight coalesces concurrent identical in-flight read requests so a
// 500-client thundering herd executes only 1 underlying PostgreSQL query.
type call struct {
	wg      sync.WaitGroup
	val     any
	err     error
	waiters int64
}

type Singleflight struct {
	mu    sync.Mutex
	calls map[string]*call
}

func NewSingleflight() *Singleflight {
	return &Singleflight{
		calls: make(map[string]*call),
	}
}

// Do executes fn once for a given key while concurrent callers wait and share the result.
// Returns (value, shared, error).
func (sf *Singleflight) Do(key string, fn func() (any, error)) (any, bool, error) {
	sf.mu.Lock()
	if c, ok := sf.calls[key]; ok {
		atomic.AddInt64(&c.waiters, 1)
		sf.mu.Unlock()
		c.wg.Wait()
		return c.val, true, c.err
	}
	c := new(call)
	c.wg.Add(1)
	sf.calls[key] = c
	sf.mu.Unlock()

	c.val, c.err = fn()
	c.wg.Done()

	sf.mu.Lock()
	delete(sf.calls, key)
	sf.mu.Unlock()

	return c.val, atomic.LoadInt64(&c.waiters) > 0, c.err
}

// TokenBucketLimiter implements a high-speed per-client token bucket rate limiter.
type bucket struct {
	mu         sync.Mutex
	tokens     float64
	lastRefill time.Time
}

type RateLimiter struct {
	shards     [cacheShardCount]sync.Map
	ratePerSec float64
	burst      float64
}

func NewRateLimiter(ratePerSec float64, burst float64) *RateLimiter {
	return &RateLimiter{
		ratePerSec: ratePerSec,
		burst:      burst,
	}
}

func (rl *RateLimiter) Allow(clientKey string) (bool, int) {
	shIdx := fnv32a(clientKey) % cacheShardCount
	now := time.Now()
	val, _ := rl.shards[shIdx].LoadOrStore(clientKey, &bucket{
		tokens:     rl.burst,
		lastRefill: now,
	})
	b := val.(*bucket)
	b.mu.Lock()
	defer b.mu.Unlock()

	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		b.tokens = math.Min(rl.burst, b.tokens+(elapsed*rl.ratePerSec))
		b.lastRefill = now
	}
	if b.tokens < 1.0 {
		return false, 0
	}
	b.tokens -= 1.0
	return true, int(b.tokens)
}

// Engine coordinates caching, singleflight coalescing, bulkhead concurrency lanes,
// rate limiting, gzip pooling, and rolling latency histograms.
type Engine struct {
	Cache        *ShardedCache
	Flight       *Singleflight
	Limiter      *RateLimiter
	readSem      chan struct{}
	writeSem     chan struct{}
	gzipPool     sync.Pool
	startedAt    time.Time
	totalReqs    atomic.Int64
	inFlight     atomic.Int64
	peakInFlight atomic.Int64
	cacheHits    atomic.Int64
	cacheMisses  atomic.Int64
	coalesced    atomic.Int64
	sqlSaved     atomic.Int64
	gzipServed   atomic.Int64
	rateDropped  atomic.Int64

	latMu   sync.Mutex
	latRing [latencyRingSize]int64 // microseconds
	latIdx  int
	latCnt  int
}

func NewEngine() *Engine {
	e := &Engine{
		Cache:     NewShardedCache(defaultCacheTTL),
		Flight:    NewSingleflight(),
		Limiter:   NewRateLimiter(800, 1600),
		readSem:   make(chan struct{}, defaultReadSlots),
		writeSem:  make(chan struct{}, defaultWriteSlots),
		startedAt: time.Now(),
	}
	e.gzipPool.New = func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	}
	return e
}

func (e *Engine) RecordLatency(d time.Duration) {
	us := d.Microseconds()
	if us <= 0 {
		us = 1
	}
	e.latMu.Lock()
	e.latRing[e.latIdx] = us
	e.latIdx = (e.latIdx + 1) % latencyRingSize
	if e.latCnt < latencyRingSize {
		e.latCnt++
	}
	e.latMu.Unlock()
}

func (e *Engine) AddSqlQueriesSaved(n int64) {
	if n > 0 {
		e.sqlSaved.Add(n)
	}
}

// CachedOrFetch looks up key in the sharded cache; on miss, coalesces concurrent
// callers via Singleflight and caches the result.
func (e *Engine) CachedOrFetch(key string, fn func() (any, error)) (any, string, error) {
	if cached, ok := e.Cache.Get(key); ok {
		e.cacheHits.Add(1)
		return cached, "HIT", nil
	}

	var callerExecuted bool
	val, shared, err := e.Flight.Do(key, func() (any, error) {
		callerExecuted = true
		if cached, ok := e.Cache.Get(key); ok {
			return cached, nil
		}
		res, fetchErr := fn()
		if fetchErr == nil && res != nil {
			e.Cache.Set(key, res)
		}
		return res, fetchErr
	})
	if err != nil {
		return nil, "ERROR", err
	}
	if !callerExecuted {
		e.coalesced.Add(1)
		e.cacheHits.Add(1)
		return val, "COALESCED", nil
	}
	e.cacheMisses.Add(1)
	if shared {
		return val, "MISS_SHARED", nil
	}
	return val, "MISS", nil
}

func (e *Engine) InvalidateTenant(tenantID string) {
	e.Cache.InvalidatePrefix(tenantID)
	e.Cache.InvalidatePrefix("global:")
}

type MetricsSnapshot struct {
	UptimeSeconds          int64   `json:"uptimeSeconds"`
	TotalRequests          int64   `json:"totalRequests"`
	InFlightRequests       int64   `json:"inFlightRequests"`
	PeakConcurrency        int64   `json:"peakConcurrency"`
	CacheHits              int64   `json:"cacheHits"`
	CacheMisses            int64   `json:"cacheMisses"`
	CacheHitRatioPct       float64 `json:"cacheHitRatioPct"`
	ActiveCacheKeys        int     `json:"activeCacheKeys"`
	SingleflightCoalesced  int64   `json:"singleflightCoalesced"`
	BatchedSqlQueriesSaved int64   `json:"batchedSqlQueriesSaved"`
	GzipResponsesServed    int64   `json:"gzipResponsesServed"`
	RateLimitedDrops       int64   `json:"rateLimitedDrops"`
	LatencyP50Ms           float64 `json:"latencyP50Ms"`
	LatencyP95Ms           float64 `json:"latencyP95Ms"`
	LatencyP99Ms           float64 `json:"latencyP99Ms"`
	LatencyAvgMs           float64 `json:"latencyAvgMs"`
	ReadBulkheadCapacity   int     `json:"readBulkheadCapacity"`
	WriteBulkheadCapacity  int     `json:"writeBulkheadCapacity"`
	ReadBulkheadInUse      int     `json:"readBulkheadInUse"`
	WriteBulkheadInUse     int     `json:"writeBulkheadInUse"`
	Goroutines             int     `json:"goroutines"`
	GoMaxProcs             int     `json:"goMaxProcs"`
	HeapAllocMb            float64 `json:"heapAllocMb"`
}

func (e *Engine) Snapshot() MetricsSnapshot {
	e.latMu.Lock()
	samples := make([]int64, e.latCnt)
	copy(samples, e.latRing[:e.latCnt])
	e.latMu.Unlock()

	var p50, p95, p99, avg float64
	if len(samples) > 0 {
		sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
		var sum int64
		for _, v := range samples {
			sum += v
		}
		avg = float64(sum) / float64(len(samples)) / 1000.0
		p50 = float64(samples[len(samples)*50/100]) / 1000.0
		p95 = float64(samples[len(samples)*95/100]) / 1000.0
		p99 = float64(samples[len(samples)*99/100]) / 1000.0
	}

	hits := e.cacheHits.Load()
	misses := e.cacheMisses.Load()
	var hitRatio float64
	if hits+misses > 0 {
		hitRatio = math.Round((float64(hits)/float64(hits+misses))*1000) / 10
	}

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	return MetricsSnapshot{
		UptimeSeconds:          int64(time.Since(e.startedAt).Seconds()),
		TotalRequests:          e.totalReqs.Load(),
		InFlightRequests:       e.inFlight.Load(),
		PeakConcurrency:        e.peakInFlight.Load(),
		CacheHits:              hits,
		CacheMisses:            misses,
		CacheHitRatioPct:       hitRatio,
		ActiveCacheKeys:        e.Cache.ActiveEntryCount(),
		SingleflightCoalesced:  e.coalesced.Load(),
		BatchedSqlQueriesSaved: e.sqlSaved.Load(),
		GzipResponsesServed:    e.gzipServed.Load(),
		RateLimitedDrops:       e.rateDropped.Load(),
		LatencyP50Ms:           math.Round(p50*100) / 100,
		LatencyP95Ms:           math.Round(p95*100) / 100,
		LatencyP99Ms:           math.Round(p99*100) / 100,
		LatencyAvgMs:           math.Round(avg*100) / 100,
		ReadBulkheadCapacity:   cap(e.readSem),
		WriteBulkheadCapacity:  cap(e.writeSem),
		ReadBulkheadInUse:      len(e.readSem),
		WriteBulkheadInUse:     len(e.writeSem),
		Goroutines:             runtime.NumGoroutine(),
		GoMaxProcs:             runtime.GOMAXPROCS(0),
		HeapAllocMb:            math.Round((float64(mem.HeapAlloc)/(1024*1024))*100) / 100,
	}
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gw *gzip.Writer
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	return w.gw.Write(b)
}

func (w *gzipResponseWriter) Flush() {
	_ = w.gw.Flush()
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// WrapHandler wraps an http.Handler with rate limiting, bulkhead concurrency control,
// pooled gzip compression, and latency histogram instrumentation.
func (e *Engine) WrapHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		e.totalReqs.Add(1)
		cur := e.inFlight.Add(1)
		for {
			prev := e.peakInFlight.Load()
			if cur <= prev || e.peakInFlight.CompareAndSwap(prev, cur) {
				break
			}
		}
		defer func() {
			e.inFlight.Add(-1)
			e.RecordLatency(time.Since(start))
		}()

		clientIP := r.Header.Get("X-Forwarded-For")
		if clientIP == "" {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err == nil {
				clientIP = host
			} else {
				clientIP = r.RemoteAddr
			}
		}

		allowed, remaining := e.Limiter.Allow(clientIP)
		w.Header().Set("X-RateLimit-Limit", "1600")
		w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
		if !allowed {
			e.rateDropped.Add(1)
			w.Header().Set("Retry-After", "1")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":"RATE_LIMITED","message":"High-traffic rate limit exceeded; retry shortly"}}`))
			return
		}

		// Acquire read or write bulkhead lane
		sem := e.readSem
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			sem = e.writeSem
		}
		select {
		case sem <- struct{}{}:
			defer func() { <-sem }()
		case <-time.After(15 * time.Second):
			w.Header().Set("Retry-After", "2")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":"BULKHEAD_BUSY","message":"Server concurrency bulkhead full"}}`))
			return
		}

		// Skip gzip for SSE stream endpoints
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") &&
			!strings.HasSuffix(r.URL.Path, "/events") {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Add("Vary", "Accept-Encoding")
			e.gzipServed.Add(1)
			gw := e.gzipPool.Get().(*gzip.Writer)
			gw.Reset(w)
			defer func() {
				_ = gw.Close()
				e.gzipPool.Put(gw)
			}()
			next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gw: gw}, r)
			return
		}

		next.ServeHTTP(w, r)
	})
}
