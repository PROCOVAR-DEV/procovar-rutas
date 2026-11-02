package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/procovar/procovar-rutas/api/internal/config"
)

// Las dos puertas nuevas son de máquina: sin la clave de servicio no se abren, y con la clave mal
// escrita tampoco. (Con la clave buena tocan la base; eso se prueba en producción con n8n.)
func TestAltaCarpetasExigeClaveDeServicio(t *testing.T) {
	s := &Server{cfg: &config.Config{ServiceKey: "clave-de-prueba"}}
	casos := []struct {
		nombre string
		h      http.HandlerFunc
		metodo string
		cuerpo string
	}{
		{"todas", s.ingestAllFolders, http.MethodGet, ""},
		{"registrar", s.ingestRegisterFolder, http.MethodPost, `{"folderId":"x","name":"GPS Ana","account":"Habana Procovar"}`},
	}
	for _, c := range casos {
		for _, clave := range []string{"", "otra"} {
			req := httptest.NewRequest(c.metodo, "/", strings.NewReader(c.cuerpo))
			if clave != "" {
				req.Header.Set("x-api-key", clave)
			}
			rec := httptest.NewRecorder()
			c.h(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s con clave %q: esperaba 401, salió %d", c.nombre, clave, rec.Code)
			}
		}
	}
}

func TestRegistrarCarpetaPideLosTresDatos(t *testing.T) {
	s := &Server{cfg: &config.Config{ServiceKey: "k"}}
	for _, cuerpo := range []string{`{}`, `{"folderId":"x","name":"GPS Ana"}`, `{"folderId":"x","account":"a"}`, `no es json`} {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(cuerpo))
		req.Header.Set("x-api-key", "k")
		rec := httptest.NewRecorder()
		s.ingestRegisterFolder(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("cuerpo %q: esperaba 400, salió %d", cuerpo, rec.Code)
		}
	}
}
