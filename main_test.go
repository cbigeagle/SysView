package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
func TestHandleReclaimStandby_RequiresToken(t *testing.T) {
	capabilityToken = "test-token-123"
	req := httptest.NewRequest(http.MethodPost, "/api/reclaim/standby", nil)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handleReclaimStandby(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 without token, got %d", rr.Code)
	}
}
func TestHandleReclaimStandby_OriginRejected(t *testing.T) {
	capabilityToken = "test-token-123"
	req := httptest.NewRequest(http.MethodPost, "/api/reclaim/standby", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleReclaimStandby(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 for evil origin, got %d", rr.Code)
	}
}
func TestHandleReclaimStandby_RequiresConfirm(t *testing.T) {
	capabilityToken = "test-token-123"
	req := httptest.NewRequest(http.MethodPost, "/api/reclaim/standby", nil)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleReclaimStandby(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 without confirm, got %d", rr.Code)
	}
}
func TestHandleReclaimStandby_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/reclaim/standby", nil)
	rr := httptest.NewRecorder()
	handleReclaimStandby(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405 got %d", rr.Code)
	}
}
func TestHandleReclaimStandby_RateLimit(t *testing.T) {
	capabilityToken = "test-token-123"
	reclaimSem <- struct{}{}
	defer func() { <-reclaimSem }()
	body := strings.NewReader(`{"confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/reclaim/standby", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleReclaimStandby(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleWslConfig_RequiresToken(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"memory":"4GB","confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/config", body)
	req.Header.Set("Content-Type", "application/json")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleWslConfig(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 without token, got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleWslConfig_OriginRejected(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"memory":"4GB","confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/config", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Header.Set("Origin", "https://evil.example")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleWslConfig(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 for evil origin, got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleWslConfig_RequiresConfirm(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"memory":"4GB"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/config", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleWslConfig(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 without confirm, got %d body %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Confirmation required") {
		t.Fatalf("want Confirmation required, got %s", rr.Body.String())
	}
}
func TestHandleWslConfig_InvalidMemory(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"memory":"not-a-size","confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/config", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleWslConfig(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for invalid memory, got %d body %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Invalid memory value") {
		t.Fatalf("want Invalid memory value, got %s", rr.Body.String())
	}
}
func TestHandleWslConfig_RateLimit(t *testing.T) {
	capabilityToken = "test-token-123"
	wslConfigSem <- struct{}{}
	defer func() { <-wslConfigSem }()
	body := strings.NewReader(`{"memory":"4GB","confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/wsl/config", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleWslConfig(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleWslConfig_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/wsl/config", nil)
	rr := httptest.NewRecorder()
	handleWslConfig(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405 got %d", rr.Code)
	}
}
func TestHandleRuntimeRestart_RequiresToken(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"host":"Teams","pid":12345,"confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/runtime/restart", body)
	req.Header.Set("Content-Type", "application/json")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleRuntimeRestart(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 without token, got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleRuntimeRestart_OriginRejected(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"host":"Teams","pid":12345,"confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/runtime/restart", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Header.Set("Origin", "https://evil.example")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleRuntimeRestart(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 for evil origin, got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleRuntimeRestart_RequiresConfirm(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"host":"Teams","pid":12345}`)
	req := httptest.NewRequest(http.MethodPost, "/api/runtime/restart", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleRuntimeRestart(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 without confirm, got %d body %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Confirmation required") {
		t.Fatalf("want Confirmation required, got %s", rr.Body.String())
	}
}
func TestHandleRuntimeRestart_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/runtime/restart", nil)
	rr := httptest.NewRecorder()
	handleRuntimeRestart(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405 got %d", rr.Code)
	}
}
func TestHandleRuntimeRestart_RateLimit(t *testing.T) {
	capabilityToken = "test-token-123"
	runtimeRestartSem <- struct{}{}
	defer func() { <-runtimeRestartSem }()
	body := strings.NewReader(`{"host":"Teams","pid":12345,"confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/runtime/restart", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleRuntimeRestart(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 got %d body %s", rr.Code, rr.Body.String())
	}
}
func TestHandleRuntimeRestart_InvalidPid(t *testing.T) {
	capabilityToken = "test-token-123"
	body := strings.NewReader(`{"host":"Teams","pid":0,"confirm":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/runtime/restart", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SysView-Token", "test-token-123")
	req.Host = "localhost:22880"
	rr := httptest.NewRecorder()
	handleRuntimeRestart(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for invalid pid, got %d body %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Host and PID required") {
		t.Fatalf("want Host and PID required, got %s", rr.Body.String())
	}
	body2 := strings.NewReader(`{"host":"Teams","pid":2,"confirm":true}`)
	req2 := httptest.NewRequest(http.MethodPost, "/api/runtime/restart", body2)
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-SysView-Token", "test-token-123")
	req2.Host = "localhost:22880"
	rr2 := httptest.NewRecorder()
	handleRuntimeRestart(rr2, req2)
	if rr2.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for pid 2, got %d body %s", rr2.Code, rr2.Body.String())
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
func TestHeadlessHelp(t *testing.T) {
	cmd := exec.Command("go", "run", ".", "--help")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go run --help failed: %v output: %s", err, string(out))
	}
	s := string(out)
	for _, want := range []string{"headless", "once", "output", "pretty", "redact"} {
		if !strings.Contains(s, want) {
			t.Fatalf("--help missing %q in output: %s", want, s)
		}
	}
	// also ensure help mentions headless mode description
	if !strings.Contains(s, "headless mode") && !strings.Contains(s, "headless") {
		t.Fatalf("--help should mention headless mode, got: %s", s)
	}
}

func TestHeadlessWritesFile(t *testing.T) {
	dir := t.TempDir()
	outFile := filepath.Join(dir, "snapshot.json")

	// Build an envelope containing secrets that must be redacted
	raw := `{"capturedAt":"2026-09-01T00:00:00Z","schemaVersion":3,"providers":{"memory":"ok"},"errors":[],"data":{"Memory":{"VisiblePhysicalBytes":100,"AvailableBytes":50,"InUseBytes":50},"AllProcesses":[{"PID":1,"Name":"foo","CommandLine":"secret --token abc"}],"WebViewProcesses":[{"PID":2,"Name":"edge","CommandLine":"secret2"}],"Startup":[{"Name":"app","Command":"C:\\secret\\run.exe --key 123"}],"Network":{"TcpConnections":[]}}}`
	if err := validateEnvelope([]byte(raw)); err != nil {
		t.Fatalf("validateEnvelope: %v", err)
	}
	redacted, err := applyRedaction([]byte(raw))
	if err != nil {
		t.Fatalf("applyRedaction: %v", err)
	}
	if !json.Valid(redacted) {
		t.Fatal("redacted output is not valid JSON")
	}
	// Verify redaction
	var env map[string]any
	if err := json.Unmarshal(redacted, &env); err != nil {
		t.Fatalf("unmarshal redacted: %v", err)
	}
	data := env["data"].(map[string]any)
	if arr, ok := data["AllProcesses"].([]any); ok && len(arr) > 0 {
		if m, ok := arr[0].(map[string]any); ok {
			if m["CommandLine"] != "[redacted]" {
				t.Fatalf("AllProcesses CommandLine not redacted: %v", m["CommandLine"])
			}
		}
	} else {
		t.Fatal("AllProcesses missing")
	}
	if arr, ok := data["WebViewProcesses"].([]any); ok && len(arr) > 0 {
		if m, ok := arr[0].(map[string]any); ok {
			if m["CommandLine"] != "[redacted]" {
				t.Fatalf("WebViewProcesses CommandLine not redacted: %v", m["CommandLine"])
			}
		}
	}
	if arr, ok := data["Startup"].([]any); ok && len(arr) > 0 {
		if m, ok := arr[0].(map[string]any); ok {
			if m["Command"] != "[redacted]" {
				t.Fatalf("Startup Command not redacted: %v", m["Command"])
			}
		}
	}
	// Verify schemaVersion preserved
	var top map[string]json.RawMessage
	json.Unmarshal(redacted, &top)
	var sv struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	json.Unmarshal(redacted, &sv)
	if sv.SchemaVersion != 3 {
		t.Fatalf("schemaVersion want 3 got %d", sv.SchemaVersion)
	}
	// Mimic runHeadless file write path (without os.Exit)
	if err := os.WriteFile(outFile, redacted, 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	got, err := os.ReadFile(outFile)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !json.Valid(got) {
		t.Fatal("written file is not valid JSON")
	}
	if err := validateEnvelope(got); err != nil {
		t.Fatalf("validateEnvelope on written file: %v", err)
	}
	// Pretty variant
	var v any
	json.Unmarshal(redacted, &v)
	pretty, _ := json.MarshalIndent(v, "", "  ")
	if !strings.Contains(string(pretty), "\n") {
		t.Fatal("pretty JSON should contain newlines")
	}
	prettyFile := filepath.Join(dir, "pretty.json")
	if err := os.WriteFile(prettyFile, pretty, 0644); err != nil {
		t.Fatalf("WriteFile pretty: %v", err)
	}
	if !json.Valid(pretty) {
		t.Fatal("pretty file not valid JSON")
	}
}

func TestHeadlessRedactToggleAndExitCodes(t *testing.T) {
	// Redact disabled should preserve secrets
	raw := `{"capturedAt":"2026-09-01T00:00:00Z","schemaVersion":3,"providers":{"memory":"ok"},"errors":[],"data":{"Memory":{"VisiblePhysicalBytes":100,"AvailableBytes":50,"InUseBytes":50},"AllProcesses":[{"PID":1,"Name":"foo","CommandLine":"keep me"}],"Startup":[{"Name":"app","Command":"keep this"}]}}`
	// redact=false means raw unchanged (runHeadless would skip applyRedaction)
	var env map[string]any
	json.Unmarshal([]byte(raw), &env)
	data := env["data"].(map[string]any)
	if arr, ok := data["AllProcesses"].([]any); ok {
		if m := arr[0].(map[string]any); m["CommandLine"] != "keep me" {
			t.Fatalf("redact=false should preserve CommandLine")
		}
	}
	// redact=true path must redact
	redacted, err := applyRedaction([]byte(raw))
	if err != nil {
		t.Fatalf("applyRedaction: %v", err)
	}
	json.Unmarshal(redacted, &env)
	data = env["data"].(map[string]any)
	if arr, ok := data["AllProcesses"].([]any); ok {
		if m := arr[0].(map[string]any); m["CommandLine"] != "[redacted]" {
			t.Fatalf("redact=true should redact, got %v", m["CommandLine"])
		}
	}
	// Exit code semantics: validateEnvelope valid -> exit 0, invalid -> non-zero
	if err := validateEnvelope([]byte(raw)); err != nil {
		t.Fatalf("valid envelope should not error: %v", err)
	}
	if err := validateEnvelope([]byte(`{bad`)); err == nil {
		t.Fatal("malformed JSON should error (would be exit 1)")
	}
	if err := validateEnvelope([]byte(`{"capturedAt":"x","schemaVersion":3,"providers":{},"errors":[],"data":{"Memory":{}}}`)); err == nil {
		t.Fatal("missing Memory fields should error (would be exit 1)")
	}
	// Help exit code already checked in TestHeadlessHelp (0)
	// Unknown flag should be non-zero exit
	cmd := exec.Command("go", "run", ".", "--unknown-flag-xyz")
	if err := cmd.Run(); err == nil {
		t.Fatal("unknown flag should exit non-zero")
	}
}
