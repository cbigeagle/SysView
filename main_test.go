package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestValidateEnvelope_OK(t *testing.T) {
	raw, _ := os.ReadFile("testdata/envelope_ok.json")
	if err := validateEnvelope(raw); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}
func TestValidateEnvelope_Malformed(t *testing.T) {
	raw, _ := os.ReadFile("testdata/envelope_malformed.json")
	if err := validateEnvelope(raw); err == nil {
		t.Fatal("want error for malformed JSON")
	}
}
func TestValidateEnvelope_MissingMemoryField(t *testing.T) {
	raw, _ := os.ReadFile("testdata/envelope_missing_memory.json")
	if err := validateEnvelope(raw); err == nil {
		t.Fatal("want error for missing VisiblePhysicalBytes")
	}
}
func TestHandleSnapshot_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/snapshot", nil)
	rr := httptest.NewRecorder()
	handleSnapshot(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405 got %d", rr.Code)
	}
}
func TestHandleSnapshot_ConcurrencyLimit429(t *testing.T) {
	// fill snapshotSem
	snapshotSem <- struct{}{}
	snapshotSem <- struct{}{}
	defer func() { <-snapshotSem; <-snapshotSem }()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	rr := httptest.NewRecorder()
	handleSnapshot(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleWslShutdown_RequiresToken(t *testing.T) {
	capabilityToken = "test-token-123"
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/shutdown", nil)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handleWslShutdown(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 without token, got %d", rr.Code)
	}
}
func TestHandleWslShutdown_RequiresConfirm(t *testing.T) {
	capabilityToken = "test-token-123"
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/shutdown", nil)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	// empty body -> should 400
	handleWslShutdown(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 without confirm, got %d", rr.Code)
	}
}
func TestHandleWslShutdown_OriginRejected(t *testing.T) {
	capabilityToken = "test-token-123"
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/shutdown", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleWslShutdown(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 for evil origin, got %d", rr.Code)
	}
}
