package store_test

import (
	"context"
	"testing"

	"github.com/procovar/procovar-rutas/api/internal/store"
	"github.com/procovar/procovar-rutas/api/internal/testdb"
)

// Dar de baja a alguien lo saca de la lista de vendedores a vigilar y deja de barrer sus carpetas,
// pero no borra nada; y desvincular un GPS lo deja sin dueño.
func TestBajaSacaAlVendedorDeLaVigilancia(t *testing.T) {
	pool := testdb.Open(t)
	q := store.New(pool)
	ctx := context.Background()

	suc, err := q.CreateBranchByKey(ctx, store.CreateBranchByKeyParams{ID: "bj-suc", Name: "BajaTest", Key: "bajatest"})
	if err != nil {
		t.Fatal(err)
	}
	vend, err := q.CreateSellerByName(ctx, store.CreateSellerByNameParams{ID: "bj-v", Name: "Persona Baja", BranchID: suc.ID})
	if err != nil {
		t.Fatal(err)
	}
	fuente, err := q.CreateSource(ctx, store.CreateSourceParams{
		ID: "bj-f", Name: "GPS Baja", FolderID: "bj-folder", Type: store.SourceSeller,
		BranchID: &suc.ID, SellerID: &vend.ID, Credential: "x",
	})
	if err != nil {
		t.Fatal(err)
	}

	enAlcance := func() bool {
		lista, err := q.SellersInScope(ctx, store.SellersInScopeParams{BranchID: suc.ID, Sellers: []string{}})
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range lista {
			if v.ID == vend.ID {
				return true
			}
		}
		return false
	}
	if !enAlcance() {
		t.Fatal("antes de la baja debía salir")
	}

	if err := q.DeactivateSourcesOfSeller(ctx, &vend.ID); err != nil {
		t.Fatal(err)
	}
	if err := q.SetSellerActive(ctx, store.SetSellerActiveParams{ID: vend.ID, Active: false}); err != nil {
		t.Fatal(err)
	}
	if enAlcance() {
		t.Fatal("dado de baja no debía salir")
	}
	f, err := q.SourceByID(ctx, fuente.ID)
	if err != nil || f.Active {
		t.Fatalf("su carpeta debía quedar sin barrer: %v %v", f.Active, err)
	}

	if err := q.ClearSourceSeller(ctx, fuente.ID); err != nil {
		t.Fatal(err)
	}
	f, _ = q.SourceByID(ctx, fuente.ID)
	if f.SellerID != nil {
		t.Fatal("desvinculada debía quedar sin dueño")
	}
}
