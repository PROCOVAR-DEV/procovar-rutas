package sucursales

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/procovar/procovar-rutas/api/internal/auth"
	"github.com/procovar/procovar-rutas/api/internal/gpx"
	"github.com/procovar/procovar-rutas/api/internal/store"
)

// Gente es quien sabe los usuarios de Accesos (el cliente de procovar-auth).
type Gente interface {
	Members(ctx context.Context, orgID string, roles []string) ([]auth.Miembro, error)
}

// EmparejarConAccesos casa, sola, a cada vendedor de PEDIDO con su usuario de Accesos.
//
// Las dos listas son la misma gente: el código de un vendedor de PEDIDO es el usuario de Accesos
// («georlis.cardenas») y su nombre es el nombre de la persona. Nadie tiene que decirlo a mano: si el
// código o el nombre completo coinciden con los de UNA persona —y es de la misma sucursal—, se le
// crea su ficha aquí (si no la tiene) y se enlazan. Lo que ya decidió una persona a mano no se toca, y lo dudoso (dos
// personas con ese usuario, otra sucursal) se deja sin emparejar para que lo diga alguien.
func EmparejarConAccesos(ctx context.Context, q *store.Queries, gente Gente) (int, error) {
	miembros, err := gente.Members(ctx, "", nil)
	if err != nil {
		return 0, err
	}

	porUsuario := map[string][]auth.Miembro{}
	porNombre := map[string][]auth.Miembro{}
	for _, m := range miembros {
		if usuario := gpx.Normalize(strings.SplitN(m.Email, "@", 2)[0]); usuario != "" {
			porUsuario[usuario] = append(porUsuario[usuario], m)
		}
		if nombre := gpx.Normalize(m.Name); nombre != "" {
			porNombre[nombre] = append(porNombre[nombre], m)
		}
	}

	sucursales, err := q.ActiveBranches(ctx)
	if err != nil {
		return 0, err
	}
	sucursalDeOrg := map[string]string{}
	for _, b := range sucursales {
		if b.AuthOrgID != nil {
			sucursalDeOrg[*b.AuthOrgID] = b.ID
		}
	}

	vendedores, err := q.VendorsWithLink(ctx, "")
	if err != nil {
		return 0, err
	}

	n := 0
	for _, v := range vendedores {
		if v.SellerID != "" || !v.Active || v.Code == nil {
			continue
		}
		codigo := strings.TrimSpace(*v.Code)
		// Por el código (el usuario) o por el nombre completo; cuenta si sale UNA sola persona.
		unicas := map[string]auth.Miembro{}
		for _, m := range porUsuario[gpx.Normalize(codigo)] {
			unicas[m.ID] = m
		}
		for _, m := range porNombre[gpx.Normalize(v.Name)] {
			unicas[m.ID] = m
		}
		if len(unicas) != 1 {
			continue
		}
		var persona auth.Miembro
		for _, m := range unicas {
			persona = m
		}

		sucursal := sucursalDeOrg[persona.OrganizationID]
		if sucursal == "" || (v.BranchID != nil && *v.BranchID != sucursal) {
			continue // sin sucursal enlazada, o la persona es de otra: que lo mire alguien
		}

		ficha, err := q.SellerByAuthID(ctx, &persona.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			ficha, err = q.CreateSellerFromAuth(ctx, store.CreateSellerFromAuthParams{
				ID: nuevoID(), Name: persona.Name, BranchID: sucursal, AuthUserID: &persona.ID,
			})
		}
		if err != nil {
			return n, err
		}

		if err := q.UpsertSellerLink(ctx, store.UpsertSellerLinkParams{
			ID:         idEnlace(sucursal, codigo),
			BranchID:   sucursal,
			SellerID:   ficha.ID,
			VendorCode: codigo,
			VendorName: v.Name,
			Origin:     "auto",
		}); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// idEnlace es el mismo id que calcula la API al emparejar a mano (sucursal + código), para que
// los dos caminos escriban la MISMA fila y no dos.
func idEnlace(sucursalID, codigo string) string {
	suma := sha256.Sum256([]byte(sucursalID + ":" + codigo))
	return hex.EncodeToString(suma[:16])
}
