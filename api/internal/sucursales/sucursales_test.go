package sucursales

import (
	"context"
	"testing"

	"github.com/procovar/procovar-rutas/api/internal/auth"
	"github.com/procovar/procovar-rutas/api/internal/store"
	"github.com/procovar/procovar-rutas/api/internal/testdb"
)

type falsa []auth.Sucursal

func (f falsa) Sucursales(context.Context) ([]auth.Sucursal, error) { return f, nil }

// «Granma» de Accesos (GR) tiene que caer en la sucursal «Bayamo» que ya salió de Drive, y una
// sucursal nueva de Accesos tiene que nacer sola; correrlo dos veces no duplica nada.
func TestSincronizarEnlazaPorCodigoYCreaLasNuevas(t *testing.T) {
	pool := testdb.Open(t)
	q := store.New(pool)
	ctx := context.Background()

	bayamo, err := q.CreateBranchByKey(ctx, store.CreateBranchByKeyParams{ID: "b1", Name: "Bayamo", Key: "bayamo"})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.LinkBranchToAccesos(ctx, store.LinkBranchToAccesosParams{ID: bayamo.ID, Code: "GR", Active: true}); err != nil {
		t.Fatal(err)
	}

	f := falsa{
		{ID: "org-gr", Codigo: "GR", Nombre: "Granma", Activa: true},
		{ID: "org-nueva", Codigo: "NUE", Nombre: "Nueva", Activa: true},
	}
	for i := 0; i < 2; i++ {
		if _, err := Sincronizar(ctx, q, f); err != nil {
			t.Fatal(err)
		}
	}

	gr, err := q.BranchByCode(ctx, ptr("GR"))
	if err != nil || gr.ID != bayamo.ID {
		t.Fatalf("GR debe ser Bayamo: %v %v", gr.ID, err)
	}
	if gr.AuthOrgID == nil || *gr.AuthOrgID != "org-gr" {
		t.Fatalf("falta el enlace con Accesos: %v", gr.AuthOrgID)
	}
	if _, err := q.BranchByCode(ctx, ptr("NUE")); err != nil {
		t.Fatalf("la sucursal nueva de Accesos debía crearse sola: %v", err)
	}
}

func ptr(s string) *string { return &s }
