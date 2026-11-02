package api

import (
	"encoding/json"
	"net/http"
)

// GET /api/ingest/folders/all — todas las carpetas que el panel conoce, activas o no.
//
// n8n la usa para descubrir carpetas NUEVAS: lo que no esté aquí y tenga .gpx es candidato a alta.
// Va aparte de /api/ingest/folders (solo las activas, las que se leen) porque una carpeta que una
// persona desactivó tiene que seguir contando como conocida.
func (s *Server) ingestAllFolders(w http.ResponseWriter, r *http.Request) {
	if !s.validServiceKey(r) {
		respondError(w, http.StatusUnauthorized, "clave de servicio inválida")
		return
	}
	ids, err := s.q.AllSourceFolderIDs(r.Context())
	if err != nil {
		s.fail(w, "carpetas conocidas", err)
		return
	}
	type carpeta struct {
		FolderID string `json:"folderId"`
	}
	out := make([]carpeta, 0, len(ids))
	for _, id := range ids {
		out = append(out, carpeta{FolderID: id})
	}
	respond(w, http.StatusOK, out)
}

// POST /api/ingest/register-folder — n8n da de alta una carpeta de GPS que ha encontrado sola.
// Idempotente: si el panel ya la conoce (activa o no) contesta created=false y no toca nada.
func (s *Server) ingestRegisterFolder(w http.ResponseWriter, r *http.Request) {
	if !s.validServiceKey(r) {
		respondError(w, http.StatusUnauthorized, "clave de servicio inválida")
		return
	}
	var p struct {
		FolderID string `json:"folderId"`
		Name     string `json:"name"`
		Account  string `json:"account"`
	}
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		respondError(w, http.StatusBadRequest, "cuerpo ilegible")
		return
	}
	if p.FolderID == "" || p.Name == "" || p.Account == "" {
		respondError(w, http.StatusBadRequest, "hacen falta folderId, name y account")
		return
	}
	creada, branch, err := s.ingest.RegisterFolder(r.Context(), p.FolderID, p.Name, p.Account)
	if err != nil {
		s.fail(w, "dar de alta la carpeta", err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"created": creada, "branch": branch})
}
