package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed static/*
var staticFiles embed.FS

//go:embed snapshot.ps1
var snapshotScript string

const defaultPort = 22880

var (
	capabilityToken string
	snapshotSem     = make(chan struct{}, 2)
	wslSem         = make(chan struct{}, 1)
	reclaimSem     = make(chan struct{}, 1)
)
// zero-alloc envelope validation types (H4T1)
type envelopeTop struct {
	Data          json.RawMessage `json:"data"`
	LegacyMemory  json.RawMessage `json:"Memory"`
}

type dataMem struct {
	Memory json.RawMessage `json:"Memory"`
}

type memFields struct {
	VisiblePhysicalBytes *int64 `json:"VisiblePhysicalBytes"`
	InUseBytes           *int64 `json:"InUseBytes"`
	AvailableBytes       *int64 `json:"AvailableBytes"`
}

func main() {
	var headless bool
	var once bool
	var output string
	var pretty bool
	redact := true
	flag.BoolVar(&headless, "headless", false, "Run in headless mode (write snapshot JSON to stdout or file, no HTTP server)")
	flag.BoolVar(&once, "once", false, "Alias for --headless (run once then exit)")
	flag.StringVar(&output, "output", "", "Output file for headless mode (default stdout)")
	flag.BoolVar(&pretty, "pretty", false, "Pretty-print JSON in headless mode")
	flag.BoolVar(&redact, "redact", true, "Redact CommandLine/Command fields in headless output (default true)")
	portFlag := flag.Int("port", 0, "Explicit port to run the server on (overrides auto-detection)")
	flag.Parse()

	if headless || once {
		runHeadless(output, pretty, redact)
		return
	}

	var port int
	if *portFlag > 0 {
		ln, err := net.Listen("tcp", net.JoinHostPort(net.IPv4(127,0,0,1).String(), strconv.Itoa(*portFlag)))
		if err != nil {
			log.Fatalf("Port %d is already in use. Please select a different port.", *portFlag)
		}
		ln.Close()
		port = *portFlag
	} else {
		port = findAvailablePort(defaultPort)
	}

	addr := net.JoinHostPort(net.IPv4(127,0,0,1).String(), strconv.Itoa(port))
	capabilityToken = generateToken()

	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("Error sub-embedding static files: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/snapshot", handleSnapshot)
	mux.HandleFunc("/api/wsl/shutdown", handleWslShutdown)
	mux.HandleFunc("/api/reclaim/standby", handleReclaimStandby)
	mux.HandleFunc("/api/config", handleConfig)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if path != "index.html" {
			if _, err := fs.Stat(staticFS, path); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		if path == "index.html" {
			serveIndexWithToken(w, r, staticFS)
			return
		}
		http.FileServer(http.FS(staticFS)).ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverUrl := fmt.Sprintf("http://localhost:%d", port)
	fmt.Printf("=========================================\n")
	fmt.Printf("SysView Diagnostics Utility\n")
	fmt.Printf("Server listening on: %s\n", serverUrl)
	fmt.Printf("Press Ctrl+C in this terminal to exit.\n")
	fmt.Printf("=========================================\n")

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	openBrowser(serverUrl)
	select {}
}

func generateToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("Failed to generate token: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func serveIndexWithToken(w http.ResponseWriter, r *http.Request, fsys fs.FS) {
	data, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	html := string(data)
	if strings.Contains(html, "__SYSVIEW_TOKEN__") {
		html = strings.ReplaceAll(html, "__SYSVIEW_TOKEN__", capabilityToken)
	} else {
		inject := fmt.Sprintf(`<meta name="sysview-token" content="%s"><script>window.__SYSVIEW_TOKEN__="%s";</script>`, capabilityToken, capabilityToken)
		html = strings.Replace(html, "</head>", inject+"</head>", 1)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-SysView-Token", capabilityToken)
	_, _ = io.WriteString(w, html)
}

func handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if !isSameOrigin(r) {
		http.Error(w, `{"error":"Forbidden origin"}`, http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"token": capabilityToken})
}

func isSameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		if !(strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://"+net.IPv4(127,0,0,1).String()+":")) {
			return false
		}
	}
	sfs := r.Header.Get("Sec-Fetch-Site")
	if sfs != "" && sfs != "same-origin" && sfs != "none" {
		if r.Method == http.MethodPost && sfs == "cross-site" {
			return false
		}
	}
	host := r.Host
	if host != "" {
		h, _, err := net.SplitHostPort(host)
		if err != nil {
			h = host
		}
		if h != "localhost" && h != net.IPv4(127,0,0,1).String() {
			return false
		}
	}
	return true
}

func requireToken(r *http.Request) bool {
	tok := r.Header.Get("X-SysView-Token")
	if tok == "" {
		tok = r.Header.Get("X-Sysview-Token")
	}
	if tok == "" {
		tok = r.URL.Query().Get("token")
	}
	return tok != "" && tok == capabilityToken
}

func validateEnvelope(raw []byte) error {
	var env envelopeTop
	if err := json.Unmarshal(raw, &env); err != nil {
		return err
	}
	if env.Data == nil && env.LegacyMemory == nil {
		return fmt.Errorf("missing data/Memory")
	}
	if env.Data != nil {
		var dm dataMem
		if err := json.Unmarshal(env.Data, &dm); err == nil {
			if dm.Memory != nil {
				return validateMemoryRaw(dm.Memory)
			}
		}
	}
	return nil
}
func validateMemoryRaw(memRaw json.RawMessage) error {
	var mem memFields
	if err := json.Unmarshal(memRaw, &mem); err != nil {
		return err
	}
	if mem.VisiblePhysicalBytes == nil {
		return fmt.Errorf("missing Memory.VisiblePhysicalBytes")
	}
	if mem.InUseBytes == nil {
		return fmt.Errorf("missing Memory.InUseBytes")
	}
	if mem.AvailableBytes == nil {
		return fmt.Errorf("missing Memory.AvailableBytes")
	}
	return nil
}

func handleSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed. Use GET."}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	select {
	case snapshotSem <- struct{}{}:
		defer func() { <-snapshotSem }()
	default:
		http.Error(w, `{"error":"Snapshot busy, try again"}`, http.StatusTooManyRequests)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	tmpFile, err := os.CreateTemp("", "snapshot-*.ps1")
	if err != nil {
		http.Error(w, `{"error":"Failed to create temp file"}`, http.StatusInternalServerError)
		return
	}
	if _, err := tmpFile.WriteString(snapshotScript); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		http.Error(w, `{"error":"Failed to write temp file"}`, http.StatusInternalServerError)
		return
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmpFile.Name())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		http.Error(w, `{"error":"Snapshot timed out"}`, http.StatusGatewayTimeout)
		return
	}
	if err != nil {
		log.Printf("PowerShell Execution Error: %v\nStderr: %s\n", err, stderr.String())
		http.Error(w, fmt.Sprintf(`{"error": "PowerShell collection failed", "details": %q}`, stderr.String()), http.StatusInternalServerError)
		return
	}
	raw := stdout.Bytes()
	if len(raw) > 10<<20 {
		http.Error(w, `{"error":"Snapshot output too large"}`, http.StatusInternalServerError)
		return
	}
	if len(raw) == 0 {
		http.Error(w, `{"error":"Empty snapshot output"}`, http.StatusInternalServerError)
		return
	}
	if err := validateEnvelope(raw); err != nil {
		if err.Error() == "missing data/Memory" {
			http.Error(w, `{"error":"Snapshot missing required fields"}`, http.StatusInternalServerError)
			return
		}
		if strings.HasPrefix(err.Error(), "missing Memory.") {
			k := strings.TrimPrefix(err.Error(), "missing Memory.")
			http.Error(w, fmt.Sprintf(`{"error":"Snapshot missing Memory.%s"}`, k), http.StatusInternalServerError)
			return
		}
		log.Printf("Snapshot produced invalid JSON: %v\nOutput: %s\n", err, string(raw[:min(2000, len(raw))]))
		http.Error(w, fmt.Sprintf(`{"error":"Invalid snapshot JSON", "details":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	if _, err = w.Write(raw); err != nil {
		log.Printf("Error writing API response: %v", err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func findAvailablePort(startPort int) int {
	for port := startPort; port < startPort+100; port++ {
		ln, err := net.Listen("tcp", net.JoinHostPort(net.IPv4(127,0,0,1).String(), strconv.Itoa(port)))
		if err == nil {
			ln.Close()
			return port
		}
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(net.IPv4(127,0,0,1).String(), "0"))
	if err != nil {
		return startPort
	}
	defer ln.Close()
	_, portStr, _ := net.SplitHostPort(ln.Addr().String())
	p, _ := strconv.Atoi(portStr)
	return p
}

func collectSnapshot(ctx context.Context) ([]byte, error) {
	tmpFile, err := os.CreateTemp("", "snapshot-*.ps1")
	if err != nil {
		return nil, fmt.Errorf("create temp file: %w", err)
	}
	if _, err := tmpFile.WriteString(snapshotScript); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return nil, fmt.Errorf("write temp file: %w", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmpFile.Name())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("snapshot timed out")
	}
	if err != nil {
		if stderr.Len() > 0 {
			return nil, fmt.Errorf("powershell collection failed: %v: %s", err, stderr.String())
		}
		return nil, fmt.Errorf("powershell collection failed: %w", err)
	}
	raw := stdout.Bytes()
	if len(raw) > 10<<20 {
		return nil, fmt.Errorf("snapshot output too large")
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("empty snapshot output")
	}
	return raw, nil
}

func applyRedaction(raw []byte) ([]byte, error) {
	var env map[string]interface{}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, err
	}
	data, ok := env["data"].(map[string]interface{})
	if !ok {
		return raw, nil
	}
	if arr, ok := data["WebViewProcesses"].([]interface{}); ok {
		for _, v := range arr {
			if m, ok := v.(map[string]interface{}); ok {
				if _, has := m["CommandLine"]; has {
					m["CommandLine"] = "[redacted]"
				}
			}
		}
	}
	if arr, ok := data["AllProcesses"].([]interface{}); ok {
		for _, v := range arr {
			if m, ok := v.(map[string]interface{}); ok {
				if _, has := m["CommandLine"]; has {
					m["CommandLine"] = "[redacted]"
				}
			}
		}
	}
	if arr, ok := data["Startup"].([]interface{}); ok {
		for _, v := range arr {
			if m, ok := v.(map[string]interface{}); ok {
				if _, has := m["Command"]; has {
					m["Command"] = "[redacted]"
				}
			}
		}
	}
	return json.Marshal(env)
}

func runHeadless(output string, pretty, redact bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	raw, err := collectSnapshot(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "{\"error\":%q}\n", err.Error())
		os.Exit(1)
	}
	if err := validateEnvelope(raw); err != nil {
		fmt.Fprintf(os.Stderr, "{\"error\":\"validation failed\",\"details\":%q}\n", err.Error())
		os.Exit(1)
	}
	out := raw
	if redact {
		if redacted, err := applyRedaction(raw); err == nil {
			out = redacted
		} else {
			fmt.Fprintf(os.Stderr, "{\"error\":\"redaction failed\",\"details\":%q}\n", err.Error())
			os.Exit(1)
		}
	}
	if pretty {
		var v interface{}
		if err := json.Unmarshal(out, &v); err == nil {
			if p, err := json.MarshalIndent(v, "", "  "); err == nil {
				out = p
			}
		}
	}
	if output != "" {
		if err := os.WriteFile(output, out, 0644); err != nil {
			fmt.Fprintf(os.Stderr, "{\"error\":\"write output failed\",\"details\":%q}\n", err.Error())
			os.Exit(1)
		}
	} else {
		os.Stdout.Write(out)
		if len(out) > 0 && out[len(out)-1] != '\n' {
			os.Stdout.Write([]byte("\n"))
		}
	}
	os.Exit(0)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	err := cmd.Start()
	if err != nil {
		fmt.Printf("Failed to open browser automatically: %v\n", err)
		fmt.Printf("Please open your browser manually and navigate to: %s\n", url)
	}
}

func handleWslShutdown(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed. Use POST."}`, http.StatusMethodNotAllowed)
		return
	}
	if !isSameOrigin(r) {
		http.Error(w, `{"error":"Forbidden origin"}`, http.StatusForbidden)
		return
	}
	if !requireToken(r) {
		http.Error(w, `{"error":"Missing or invalid capability token"}`, http.StatusForbidden)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var req map[string]json.RawMessage
	if len(body) > 0 {
		_ = json.Unmarshal(body, &req)
	}
	if raw, ok := req["confirm"]; ok {
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil || !v {
			http.Error(w, `{"error":"Confirmation required"}`, http.StatusBadRequest)
			return
		}
	} else {
		http.Error(w, `{"error":"Confirmation required"}`, http.StatusBadRequest)
		return
	}
	select {
	case wslSem <- struct{}{}:
		defer func() { <-wslSem }()
	default:
		http.Error(w, `{"error":"WSL shutdown already in progress"}`, http.StatusTooManyRequests)
		return
	}
	log.Println("Received request to shutdown WSL...")
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "wsl.exe", "--shutdown")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		http.Error(w, `{"error":"WSL shutdown timed out"}`, http.StatusGatewayTimeout)
		return
	}
	if err != nil {
		log.Printf("Error running wsl --shutdown: %v, stderr: %s\n", err, stderr.String())
		http.Error(w, fmt.Sprintf(`{"error": "Failed to shutdown WSL", "details": %q}`, stderr.String()), http.StatusInternalServerError)
		return
	}
	log.Println("WSL VM successfully shut down.")
	w.Write([]byte(`{"status": "success", "message": "WSL VM successfully shut down and memory released."}`))
}

func handleReclaimStandby(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed. Use POST."}`, http.StatusMethodNotAllowed)
		return
	}
	if !isSameOrigin(r) {
		http.Error(w, `{"error":"Forbidden origin"}`, http.StatusForbidden)
		return
	}
	if !requireToken(r) {
		http.Error(w, `{"error":"Missing or invalid capability token"}`, http.StatusForbidden)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if len(body) == 0 {
		http.Error(w, `{"error":"Confirmation required"}`, http.StatusBadRequest)
		return
	}
	var req map[string]json.RawMessage
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, `{"error":"Confirmation required"}`, http.StatusBadRequest)
		return
	}
	if raw, ok := req["confirm"]; ok {
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil || !v {
			http.Error(w, `{"error":"Confirmation required"}`, http.StatusBadRequest)
			return
		}
	} else {
		http.Error(w, `{"error":"Confirmation required"}`, http.StatusBadRequest)
		return
	}
	select {
	case reclaimSem <- struct{}{}:
		defer func() { <-reclaimSem }()
	default:
		http.Error(w, `{"error":"Reclaim already in progress"}`, http.StatusTooManyRequests)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	psScript := `
$ErrorActionPreference='Stop'
function Get-StandbyBytes {
    $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    return [int64]($m.StandbyCacheCoreBytes + $m.StandbyCacheNormalPriorityBytes + $m.StandbyCacheReserveBytes)
}
$before = Get-StandbyBytes
try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeMem {
    [DllImport("ntdll.dll")] public static extern int NtSetSystemInformation(int v, ref int a, int b);
    [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr h, int a, out IntPtr t);
    [DllImport("advapi32.dll", SetLastError=true)] public static extern bool LookupPrivilegeValue(string s, string n, out long id);
    [DllImport("advapi32.dll", SetLastError=true)] public static extern bool AdjustTokenPrivileges(IntPtr t, bool d, ref long b, int c, IntPtr e, IntPtr f);
}
"@ -ErrorAction Stop
    $tok=[IntPtr]::Zero
    if ([NativeMem]::OpenProcessToken((Get-Process -Id $PID).Handle, 32, [ref]$tok)) {
        $luid=0
        if ([NativeMem]::LookupPrivilegeValue($null, "SeProfileSingleProcessPrivilege", [ref]$luid)) {
            [void][NativeMem]::AdjustTokenPrivileges($tok, $false, [ref]$luid, 0, [IntPtr]::Zero, [IntPtr]::Zero)
        }
    }
    $info=4
    $st=[NativeMem]::NtSetSystemInformation(80, [ref]$info, 4)
    if ($st -ne 0) {
        if ($st -eq 1314 -or $st.ToString('X8') -eq 'C0000061') { Write-Error "REQUIRES_ADMIN"; exit 1 }
        $msg=[System.ComponentModel.Win32Exception]::new($st).Message
        if ($msg -match "privilege") { Write-Error "REQUIRES_ADMIN"; exit 1 }
        Write-Error "RECLAIM_FAILED: NtSetSystemInformation status 0x$($st.ToString('X8')) $msg"
        exit 1
    }
} catch {
    $msg=$_.Exception.Message
    if ($msg -match "privilege" -or $msg -match "REQUIRES_ADMIN") { Write-Error "REQUIRES_ADMIN"; exit 1 }
    if ($msg -match "REQUIRES_ADMIN") { Write-Error "REQUIRES_ADMIN"; exit 1 }
    Write-Error "RECLAIM_FAILED: $msg"
    exit 1
}
Start-Sleep -Milliseconds 200
$after = Get-StandbyBytes
$reclaimed = $before - $after
if ($reclaimed -lt 0) { $reclaimed = 0 }
@{beforeBytes=$before; afterBytes=$after; reclaimedBytes=$reclaimed} | ConvertTo-Json -Compress | Write-Host
`
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		http.Error(w, `{"error":"Reclaim timed out"}`, http.StatusGatewayTimeout)
		return
	}
	stderrStr := stderr.String()
	if strings.Contains(stderrStr, "REQUIRES_ADMIN") || strings.Contains(strings.ToLower(stderrStr), "privilege") {
		http.Error(w, `{"error":"Requires Administrator","details":"Run SysView.exe as Administrator to reclaim standby"}`, http.StatusForbidden)
		return
	}
	if strings.Contains(stderrStr, "RECLAIM_FAILED") {
		http.Error(w, fmt.Sprintf(`{"error":"Reclaim failed","details":%q}`, stderrStr), http.StatusInternalServerError)
		return
	}
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Reclaim failed","details":%q}`, stderrStr), http.StatusInternalServerError)
		return
	}
	raw := stdout.Bytes()
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		http.Error(w, `{"error":"Reclaim failed","details":"empty output"}`, http.StatusInternalServerError)
		return
	}
	if len(raw) > 1<<20 {
		http.Error(w, `{"error":"Reclaim output too large"}`, http.StatusInternalServerError)
		return
	}
	var res struct {
		BeforeBytes    *int64 `json:"beforeBytes"`
		AfterBytes     *int64 `json:"afterBytes"`
		ReclaimedBytes *int64 `json:"reclaimedBytes"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Reclaim failed","details":%q}`, string(raw[:min(500, len(raw))])), http.StatusInternalServerError)
		return
	}
	if res.BeforeBytes == nil || res.AfterBytes == nil || res.ReclaimedBytes == nil {
		http.Error(w, `{"error":"Reclaim failed","details":"missing fields"}`, http.StatusInternalServerError)
		return
	}
	beforeGB := float64(*res.BeforeBytes) / (1 << 30)
	afterGB := float64(*res.AfterBytes) / (1 << 30)
	freedMB := float64(*res.ReclaimedBytes) / (1 << 20)
	msg := fmt.Sprintf("Standby reclaimed: %.2f GB \u2192 %.2f GB (%.0f MB freed)", beforeGB, afterGB, freedMB)
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "success",
		"beforeBytes":    *res.BeforeBytes,
		"afterBytes":     *res.AfterBytes,
		"reclaimedBytes": *res.ReclaimedBytes,
		"message":        msg,
	})
}
