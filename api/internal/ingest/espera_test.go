package ingest_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/procovar/procovar-rutas/api/internal/ingest"
)

// El caso del 23/10/2026: los primeros intentos fallan y luego Redis contesta.
func TestEsperarRedisInsisteHastaQueContesta(t *testing.T) {
	intentos := 0
	ping := func(context.Context) error {
		intentos++
		if intentos < 4 {
			return errors.New("lookup procovar-redis: no such host")
		}
		return nil
	}
	if !ingest.EsperarRedis(context.Background(), ping, time.Millisecond, nil2()) {
		t.Fatal("tenía que acabar devolviendo true")
	}
	if intentos != 4 {
		t.Errorf("intentos = %d, se esperaban 4", intentos)
	}
}

func TestEsperarRedisSeParaAlCancelar(t *testing.T) {
	ctx, cancelar := context.WithCancel(context.Background())
	ping := func(context.Context) error { cancelar(); return errors.New("sigue caído") }
	if ingest.EsperarRedis(ctx, ping, time.Hour, nil2()) {
		t.Fatal("cancelado, no puede devolver true")
	}
}

func nil2() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }
