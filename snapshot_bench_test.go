package main

import (
	"os"
	"testing"
)

func BenchmarkValidateEnvelope(b *testing.B) {
	raw, err := os.ReadFile("testdata/envelope_ok.json")
	if err != nil {
		b.Fatalf("read fixture: %v", err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		_ = validateEnvelope(raw)
	}
}
