// Package sucursales mantiene las sucursales de Rutas al día con Accesos.
//
// La sucursal es de Accesos (`Organization.codigo`), y el código es lo que comparten todas
// las aplicaciones: PEDIDO lo manda con cada pedido y cada vendedor. Aquí nacían de los
// nombres de las cuentas de Drive, y cuando el nombre no coincidía («Granma» en PEDIDO,
// «Bayamo» en Drive) sus vendedores salían «sin sucursal» y sus pedidos se descartaban.
// Esto lo arregla solo, sin que nadie toque código ni datos: al arrancar y cada hora pregunta
// a Accesos por sus sucursales y las enlaza por código.
package sucursales

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/procovar/procovar-rutas/api/internal/auth"
	"github.com/procovar/procovar-rutas/api/internal/gpx"
	"github.com/procovar/procovar-rutas/api/internal/store"
)

// Fuente es quien sabe las sucursales de Accesos (el cliente de procovar-auth).
type Fuente interface {
	Sucursales(ctx context.Context) ([]auth.Sucursal, error)
}

// Sincronizar enlaza cada sucursal de Accesos con la suya de Rutas y devuelve cuántas tocó.
//
// Se busca primero por código; si no, por la clave del nombre (las que ya salieron de Drive);
// y si tampoco, se crea: Accesos es quien dice qué sucursales hay. El nombre de Rutas no se
// toca, que de él cuelgan las claves de Drive.
func Sincronizar(ctx context.Context, q *store.Queries, fuente Fuente) (int, error) {
	lista, err := fuente.Sucursales(ctx)
	if err != nil {
		return 0, err
	}

	n := 0
	for _, s := range lista {
		codigo := strings.TrimSpace(s.Codigo)
		if codigo == "" {
			continue // sin código ningún sistema sabría llamarla
		}

		suc, err := q.BranchByCode(ctx, &codigo)
		if errors.Is(err, pgx.ErrNoRows) {
			clave := gpx.Normalize(s.Nombre)
			suc, err = q.BranchByKey(ctx, clave)
			if errors.Is(err, pgx.ErrNoRows) {
				suc, err = q.CreateBranchByKey(ctx, store.CreateBranchByKeyParams{
					ID: nuevoID(), Name: s.Nombre, Key: clave,
				})
			}
		}
		if err != nil {
			return n, err
		}

		if err := q.LinkBranchToAccesos(ctx, store.LinkBranchToAccesosParams{
			ID: suc.ID, Code: codigo, Active: s.Activa, AuthOrgID: s.ID,
		}); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// Accesos es lo que hace falta de procovar-auth: sus sucursales y su gente.
type Accesos interface {
	Fuente
	Gente
}

// Mantener sincroniza ahora y cada `cada`: primero las sucursales y luego el emparejado de los
// vendedores de PEDIDO con los usuarios de Accesos. Un fallo de Accesos se avisa y se reintenta en la
// siguiente vuelta: Rutas sigue sirviendo con lo que ya tenía.
func Mantener(ctx context.Context, q *store.Queries, accesos Accesos, log *slog.Logger, cada time.Duration) {
	vuelta := func() {
		if n, err := Sincronizar(ctx, q, accesos); err != nil {
			log.Warn("no se pudieron sincronizar las sucursales con Accesos", "error", err)
			return
		} else {
			log.Info("sucursales al día con Accesos", "sucursales", n)
		}
		if n, err := EmparejarConAccesos(ctx, q, accesos); err != nil {
			log.Warn("no se pudo emparejar a los vendedores con Accesos", "error", err)
		} else if n > 0 {
			log.Info("vendedores de PEDIDO emparejados con su usuario de Accesos", "vendedores", n)
		}
	}

	vuelta()
	t := time.NewTicker(cada)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			vuelta()
		}
	}
}

func nuevoID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("sin fuente de aleatoriedad: " + err.Error())
	}
	return hex.EncodeToString(b)
}
