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

type gentefalsa []auth.Miembro

func (g gentefalsa) Members(context.Context, string, []string) ([]auth.Miembro, error) { return g, nil }

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

// El vendedor de PEDIDO «georlis.cardenas» es el usuario de Accesos del mismo nombre: se enlazan solos,
// con ficha creada, y un código que no está en Accesos —o es de otra sucursal— se deja sin emparejar.
func TestEmparejarConAccesosPorUsuario(t *testing.T) {
	pool := testdb.Open(t)
	q := store.New(pool)
	ctx := context.Background()

	suc, err := q.CreateBranchByKey(ctx, store.CreateBranchByKeyParams{ID: "sc", Name: "Camagüey", Key: "camagueytest"})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.LinkBranchToAccesos(ctx, store.LinkBranchToAccesosParams{ID: suc.ID, Code: "CAMT", Active: true, AuthOrgID: "org-cam"}); err != nil {
		t.Fatal(err)
	}
	for i, v := range [][2]string{
		{"georlis.cardenas", "GEORLIS MICHEL CARDENAS MORA"}, // por el usuario
		{"codigo.raro", "Yoan Domínguez Hidalgo"},            // por el nombre completo
		{"nadie.mas", "VENDEDOR NADIE"},
	} {
		c := v[0]
		if err := q.UpsertVendor(ctx, store.UpsertVendorParams{
			ID: "v" + c, BranchID: &suc.ID, Ref: "ref" + c, Code: &c, Name: v[1], Active: true, Orders: int32(i),
		}); err != nil {
			t.Fatal(err)
		}
	}

	gente := gentefalsa{
		{ID: "u1", Name: "Georlis", Email: "georlis.cardenas@procovar.cloud", OrganizationID: "org-cam"},
		{ID: "u2", Name: "YOAN DOMINGUEZ HIDALGO", Email: "yoan.d@procovar.cloud", OrganizationID: "org-cam"},
	}

	// Sin ficha (a nadie se le ha asignado un GPS todavía) no se enlaza nada ni se crean fichas vacías.
	if n, err := EmparejarConAccesos(ctx, q, gente); err != nil || n != 0 {
		t.Fatalf("sin fichas no debía emparejar nada: %d (%v)", n, err)
	}

	// Al asignarles un GPS tienen ficha, y entonces se enlazan solos.
	for _, u := range []string{"u1", "u2"} {
		id := u
		if _, err := q.CreateSellerFromAuth(ctx, store.CreateSellerFromAuthParams{ID: "f" + u, Name: u, BranchID: suc.ID, AuthUserID: &id}); err != nil {
			t.Fatal(err)
		}
	}
	n, err := EmparejarConAccesos(ctx, q, gente)
	if err != nil || n != 2 {
		t.Fatalf("debía emparejar 2 (usuario y nombre), emparejó %d (%v)", n, err)
	}

	filas, err := q.VendorsWithLink(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range filas {
		if v.Code == nil {
			continue
		}
		if (*v.Code == "georlis.cardenas" || *v.Code == "codigo.raro") && v.SellerID == "" {
			t.Fatalf("%s debía quedar emparejado", *v.Code)
		}
		if *v.Code == "nadie.mas" && v.SellerID != "" {
			t.Fatal("nadie.mas no está en Accesos: no se empareja")
		}
	}
}
