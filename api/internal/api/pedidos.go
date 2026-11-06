package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/procovar/procovar-rutas/api/internal/store"
)

// Los pedidos de PEDIDO, aquí dentro: sincronizarlos, emparejar sus vendedores con
// los trabajadores de Rutas y volver a cruzar.
//
// Emparejar es lo único de esto que hace una persona, y solo cuando el automático
// no se atrevió: nombres que caen en dos vendedores, o carpetas llamadas "TABLET3".
// Se hace una vez por vendedor y no se vuelve a tocar.

// POST /api/pedidos/sync — traer la ventana de pedidos y volver a cruzar.
func (s *Server) syncPedidos(w http.ResponseWriter, r *http.Request) {
	if s.pedidos == nil || !s.pedidos.Configured() {
		respondError(w, http.StatusServiceUnavailable,
			"el cruce con PEDIDO no está configurado: falta PEDIDO_API_URL")
		return
	}

	// El botón ENCOLA, no descarga.
	//
	// A mano es siempre la pasada completa —quien lo pulsa lo pulsa porque algo no le
	// cuadra, y contestarle con el incremental, que casi siempre no trae nada, sería
	// confirmarle lo que ya estaba viendo—, pero eso son tres semanas de días, y
	// bajárselas aquí mismo dejaría la petición colgada un minuto y le metería a
	// PEDIDO la ráfaga que esta cola existe para evitar. Se dejan los días encolados
	// y el trabajador los va haciendo a su ritmo; la pantalla se entera sola por los
	// avisos en vivo, sin recargar.
	n, err := s.pedidos.Planificar(r.Context(), true)
	if err != nil {
		// El error de PEDIDO se pasa tal cual: dice "esta instalación es de la
		// sucursal X, no Y", y eso es exactamente lo que hay que leer.
		respondError(w, http.StatusBadGateway, err.Error())
		return
	}

	estado, _ := s.pedidos.EstadoDeLaCola(r.Context())
	respond(w, http.StatusOK, map[string]any{"encolados": n, "cola": estado})
}

// VendorLink is a PEDIDO vendor and who they are here.
type VendorLink struct {
	ID         string `json:"id"`
	BranchID   string `json:"branchId"`
	VendorCode string `json:"vendorCode"`
	VendorName string `json:"vendorName"`
	SellerID   string `json:"sellerId"`
	Seller     string `json:"seller"`
	Origin     string `json:"origin"`
}

// UnlinkedVendor is a PEDIDO vendor nobody here could be matched to. While they
// stay like this their orders cross with no route, and the panel says so instead
// of showing a zero that looks like a seller who did not work.
type UnlinkedVendor struct {
	BranchID   string `json:"branchId"`
	Branch     string `json:"branch"`
	VendorCode string `json:"vendorCode"`
	VendorName string `json:"vendorName"`
	Orders     int32  `json:"orders"`
	LastOrder  string `json:"lastOrder"`
}

// GET /api/pedidos/vendedores — lo emparejado y lo que falta por emparejar.
func (s *Server) vendedores(w http.ResponseWriter, r *http.Request) {
	c := FromContext(r)

	filtro, err := c.Scope(time.Now())
	if err != nil {
		respondError(w, http.StatusForbidden, err.Error())
		return
	}
	p := fromFilter(filtro)
	if p.Empty {
		respond(w, http.StatusOK, map[string]any{"links": []any{}, "unlinked": []any{}})
		return
	}

	atados, err := s.q.SellerLinks(r.Context(), p.BranchID)
	if err != nil {
		s.fail(w, "emparejamientos", err)
		return
	}
	sueltos, err := s.q.UnlinkedVendors(r.Context(), p.BranchID)
	if err != nil {
		s.fail(w, "vendedores sueltos", err)
		return
	}

	links := make([]VendorLink, 0, len(atados))
	for _, l := range atados {
		links = append(links, VendorLink{
			ID:         l.ID,
			BranchID:   l.BranchID,
			VendorCode: l.VendorCode,
			VendorName: l.VendorName,
			SellerID:   l.SellerID,
			Seller:     l.Seller,
			Origin:     l.Origin,
		})
	}

	libres := make([]UnlinkedVendor, 0, len(sueltos))
	for _, v := range sueltos {
		codigo := ""
		if v.VendorCode != nil {
			codigo = *v.VendorCode
		}
		libres = append(libres, UnlinkedVendor{
			BranchID:   v.BranchID,
			Branch:     v.Branch,
			VendorCode: codigo,
			VendorName: v.VendorLabel,
			Orders:     v.Orders,
			LastOrder:  v.LastOrder.Format(iso),
		})
	}

	respond(w, http.StatusOK, map[string]any{"links": links, "unlinked": libres})
}

type peticionEmparejar struct {
	VendorCode string `json:"vendorCode"`
	VendorName string `json:"vendorName"`
	SellerID   string `json:"sellerId"`
	// Lo normal: la persona de ACCESOS. Si todavía no tiene ficha aquí se crea, en la sucursal del
	// vendedor; el desplegable ofrece solo a la gente de Accesos, no las fichas sueltas de carpetas.
	AuthUserID string `json:"authUserId"`
	BranchID   string `json:"branchId"`
	Name       string `json:"name"`
}

// POST /api/pedidos/emparejar — decir a mano quién es quién.
//
// Queda marcado como `manual` y el automático no vuelve a opinar sobre él: si una
// persona ya dijo de quién es ese código, un parecido de nombres no puede
// deshacerlo en la siguiente pasada.
func (s *Server) emparejar(w http.ResponseWriter, r *http.Request) {
	var pet peticionEmparejar
	if err := json.NewDecoder(r.Body).Decode(&pet); err != nil {
		respondError(w, http.StatusBadRequest, "cuerpo ilegible")
		return
	}
	if pet.VendorCode == "" || (pet.SellerID == "" && pet.AuthUserID == "") {
		respondError(w, http.StatusBadRequest, "falta el vendedor o la persona")
		return
	}

	c := FromContext(r)

	// Una persona de Accesos: se usa su ficha, o se crea en la sucursal del vendedor.
	if pet.SellerID == "" {
		if t, err := s.q.SellerByAuthID(r.Context(), &pet.AuthUserID); err == nil {
			pet.SellerID = t.ID
		} else {
			if pet.BranchID == "" {
				respondError(w, http.StatusBadRequest, "ese vendedor no tiene sucursal: no se sabe dónde crear la ficha")
				return
			}
			if c.Role != "super_admin" && c.BranchID != "" && c.BranchID != pet.BranchID {
				respondError(w, http.StatusForbidden, "sin acceso a esa sucursal")
				return
			}
			nombre := pet.Name
			if nombre == "" {
				nombre = pet.VendorName
			}
			t, err := s.q.CreateSellerFromAuth(r.Context(), store.CreateSellerFromAuthParams{
				ID: newID(), Name: nombre, BranchID: pet.BranchID, AuthUserID: &pet.AuthUserID,
			})
			if err != nil {
				s.fail(w, "creando la ficha", err)
				return
			}
			pet.SellerID = t.ID
		}
	}
	filtro, err := c.Scope(time.Now())
	if err != nil {
		respondError(w, http.StatusForbidden, err.Error())
		return
	}
	p := fromFilter(filtro)

	// El trabajador tiene que ser uno que esta persona pueda ver. Sin esto, un
	// gerente de Camagüey podría atar un vendedor a alguien de Santiago.
	trab, err := s.q.SellerByID(r.Context(), pet.SellerID)
	if err != nil {
		respondError(w, http.StatusNotFound, "ese trabajador no existe")
		return
	}
	if p.Empty || (p.BranchID != "" && trab.BranchID != p.BranchID) {
		respondError(w, http.StatusForbidden, "sin acceso a ese trabajador")
		return
	}

	nombre := pet.VendorName
	if nombre == "" {
		nombre = pet.VendorCode
	}

	if err := s.q.UpsertSellerLink(r.Context(), store.UpsertSellerLinkParams{
		ID:         idEmparejamiento(trab.BranchID, pet.VendorCode),
		BranchID:   trab.BranchID,
		SellerID:   trab.ID,
		VendorCode: pet.VendorCode,
		VendorName: nombre,
		Origin:     "manual",
	}); err != nil {
		s.fail(w, "emparejando", err)
		return
	}

	// Atar y cruzar en el acto: quien acaba de emparejar quiere ver la columna
	// llena, no enterarse dentro de una hora cuando pase el temporizador.
	if s.pedidos != nil {
		if _, err := s.pedidos.MatchAndLink(r.Context()); err != nil {
			s.fail(w, "atando pedidos", err)
			return
		}
		hasta := time.Now()
		desde := hasta.AddDate(0, 0, -s.cfg.PedidoVentanaDias)
		if _, err := s.pedidos.CrossRange(r.Context(), desde, hasta); err != nil {
			s.fail(w, "cruzando", err)
			return
		}
	}

	respond(w, http.StatusOK, map[string]any{"ok": true})
}

// El identificador se deriva de (sucursal, código): así emparejar el mismo código
// dos veces corrige la fila en lugar de crear una segunda.
func idEmparejamiento(sucursalID, codigo string) string {
	suma := sha256.Sum256([]byte(sucursalID + ":" + codigo))
	return hex.EncodeToString(suma[:16])
}
