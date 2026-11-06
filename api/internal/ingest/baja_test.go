package ingest_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/procovar/procovar-rutas/api/internal/ingest"
	"github.com/procovar/procovar-rutas/api/internal/store"
	"github.com/procovar/procovar-rutas/api/internal/testdb"
)

// Una carpeta dada de baja en Rutas no deja entrar nada más: el empuje de n8n se ignora, no da error
// y no la vuelve a dar de alta.
func TestCarpetaDeBajaNoDejaEntrarFicheros(t *testing.T) {
	pool := testdb.Open(t)
	q := store.New(pool)
	ctx := context.Background()

	suc, err := q.CreateBranchByKey(ctx, store.CreateBranchByKeyParams{ID: "bjp-suc", Name: "BajaPush", Key: "bajapush"})
	if err != nil {
		t.Fatal(err)
	}
	f, err := q.CreateSource(ctx, store.CreateSourceParams{
		ID: "bjp-f", Name: "GPS Baja", FolderID: "bjp-folder", Type: store.SourceSeller, BranchID: &suc.ID, Credential: "x",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.DeactivateSource(ctx, f.ID); err != nil {
		t.Fatal(err)
	}

	svc := ingest.NewService(pool, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), 100)
	nuevo, puntos, err := svc.Receive(ctx, ingest.Pushed{
		Account: "x", FolderID: "bjp-folder", DriveFileID: "bjp-file", Name: "20261106.gpx",
		FolderPath: []string{"GPS Baja"}, Created: time.Now(), Content: []byte("<gpx/>"),
	})
	if err != nil || nuevo || puntos != 0 {
		t.Fatalf("debía ignorarse sin error: nuevo=%v puntos=%d err=%v", nuevo, puntos, err)
	}

	otra, _ := q.SourceByFolderID(ctx, "bjp-folder")
	if otra.Active {
		t.Fatal("la carpeta de baja no debía reactivarse")
	}
}
