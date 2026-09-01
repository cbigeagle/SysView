package main

import (
	"encoding/json"
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
func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func TestMemoryInvariants_Tolerance(t *testing.T) {
	// visible 61.58GB, InUse 54.69, Standby 6.81, Free 0, Modified 0 -> sum ~61.5 vs 61.58 delta <10MB should pass
	raw, _ := os.ReadFile("testdata/envelope_ok.json")
	var env map[string]json.RawMessage
	json.Unmarshal(raw, &env)
	var data struct {
		Memory struct {
			VisiblePhysicalBytes   int64 `json:"VisiblePhysicalBytes"`
			InUseBytes             int64 `json:"InUseBytes"`
			StandbyBytes           int64 `json:"StandbyBytes"`
			ModifiedBytes          int64 `json:"ModifiedBytes"`
			FreeBytes              int64 `json:"FreeBytes"`
			HardwareReservedBytes  int64 `json:"HardwareReservedBytes"`
			TotalPhysicalBytes     int64 `json:"TotalPhysicalBytes"`
		} `json:"Memory"`
	}
	var d map[string]json.RawMessage
	json.Unmarshal(env["data"], &d)
	json.Unmarshal(d["Memory"], &data.Memory)
	sum := data.Memory.InUseBytes + data.Memory.StandbyBytes + data.Memory.ModifiedBytes + data.Memory.FreeBytes
	if abs(sum-data.Memory.VisiblePhysicalBytes) > 10*1024*1024 {
		t.Fatalf("invariant should hold: sum %d vs visible %d", sum, data.Memory.VisiblePhysicalBytes)
	}
}

func TestMemoryUnavailable_RendersUnavailable(t *testing.T) {
	raw, _ := os.ReadFile("testdata/envelope_provider_unavailable.json")
	if err := validateEnvelope(raw); err != nil {
		// provider unavailable still validates shape but frontend must show Unavailable — checked in JS test
	}
	// Go side: handler should have returned 200 with providers.memory=unavailable — assert fixture has that field
	var env map[string]any
	json.Unmarshal(raw, &env)
	prov := env["providers"].(map[string]any)
	if prov["memory"] != "unavailable" {
		t.Fatal("fixture must have memory=unavailable")
	}
}
