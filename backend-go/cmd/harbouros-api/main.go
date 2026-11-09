// Command harbouros-api is the compiled Go 1.23 backend server for HarbourOS.
// It connects to the PostgreSQL engine, executes the SQL migration chain in
// db/migrations/*.sql with SHA-256 checksum verification, verifies the
// double-entry ledger chain, and serves all /api/* REST and SSE endpoints.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"harbouros/backend-go/internal/db"
	"harbouros/backend-go/internal/httpapi"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	port := os.Getenv("GO_BACKEND_PORT")
	if port == "" {
		port = "8080"
	}
	pgBridgeURL := os.Getenv("PG_BRIDGE_URL")
	if pgBridgeURL == "" {
		pgBridgeURL = "http://127.0.0.1:5433"
	}
	jwtSecret := os.Getenv("JWT_ACCESS_SECRET")
	if jwtSecret == "" {
		jwtSecret = "harbouros-default-go-jwt-secret-32-bytes-minimum"
	}
	qrSecret := os.Getenv("QR_HMAC_SECRET")
	if qrSecret == "" {
		qrSecret = "harbouros-default-go-qr-hmac-secret-32-bytes"
	}
	workspaceRoot := os.Getenv("WORKSPACE_ROOT")
	if workspaceRoot == "" {
		workspaceRoot, _ = os.Getwd()
	}
	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = workspaceRoot + "/db/migrations"
	}

	database := db.NewDB(pgBridgeURL)
	migrations, err := database.RunMigrations(ctx, migrationsDir)
	if err != nil {
		log.Fatalf("[harbouros-go] FATAL migration failure: %v", err)
	}
	log.Printf("[harbouros-go] Verified %d PostgreSQL SQL migrations via Go runner", len(migrations))

	apiServer := httpapi.NewServer(database, httpapi.Config{
		Port:           port,
		JWTSecret:      jwtSecret,
		QRHmacSecret:   qrSecret,
		OTPDevEcho:     os.Getenv("OTP_DEV_ECHO") != "false",
		DemoMode:       os.Getenv("DEMO_MODE") != "false",
		WorkspaceRoot:  workspaceRoot,
		MigrationsList: migrations,
	})

	srv := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[harbouros-go] Go 1.23 backend listening on http://127.0.0.1:%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[harbouros-go] HTTP server error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
