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
)

func main() {
	portFlag := flag.Int("port", 0, "Explicit port to run the server on (overrides auto-detection)")
	flag.Parse()

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
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		log.Printf("Snapshot produced invalid JSON: %v\nOutput: %s\n", err, string(raw[:min(2000, len(raw))]))
		http.Error(w, fmt.Sprintf(`{"error":"Invalid snapshot JSON", "details":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	hasData := false
	if _, ok := envelope["data"]; ok {
		hasData = true
	} else if _, ok := envelope["Memory"]; ok {
		hasData = true
	}
	if !hasData {
		http.Error(w, `{"error":"Snapshot missing required fields"}`, http.StatusInternalServerError)
		return
	}
	if dataRaw, ok := envelope["data"]; ok {
		var data map[string]json.RawMessage
		if err := json.Unmarshal(dataRaw, &data); err == nil {
			if memRaw, ok := data["Memory"]; ok {
				var mem map[string]json.RawMessage
				if err := json.Unmarshal(memRaw, &mem); err == nil {
					for _, k := range []string{"VisiblePhysicalBytes", "InUseBytes", "AvailableBytes"} {
						if _, ok := mem[k]; !ok {
							http.Error(w, fmt.Sprintf(`{"error":"Snapshot missing Memory.%s"}`, k), http.StatusInternalServerError)
							return
						}
					}
				}
			}
		}
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
	} else if len(body) > 0 {
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
