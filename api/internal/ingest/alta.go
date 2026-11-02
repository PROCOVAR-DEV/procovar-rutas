package ingest

import (
	"context"
	"fmt"
	"strings"

	"github.com/procovar/procovar-rutas/api/internal/store"
)

// RegisterFolder da de alta una carpeta de GPS que n8n ha descubierto en el Drive de una cuenta.
//
// POR QUÉ EXISTE. Hasta ahora cada perfil de GPS nuevo (o rehecho: al recrearlo, GPSLogger crea
// una carpeta nueva con el mismo nombre) había que darlo de alta a mano, y mientras nadie lo
// hacía sus .gpx se quedaban en Drive sin entrar. El 02/11/2026 había 27 carpetas así en seis
// sucursales. Ahora n8n las encuentra solo y las registra aquí.
//
// Devuelve creada=false si el panel YA conoce esa carpeta, esté activa o no: una carpeta que
// una persona desactivó a propósito no se reactiva ni se vuelve a dar de alta.
// Se da de alta como MIXTA, igual que las que se registraban a mano: el trabajador de cada
// fichero lo decide el alias del perfil, no la carpeta.
func (s *Service) RegisterFolder(ctx context.Context, folderID, name, account string) (creada bool, branchID string, err error) {
	folderID, name, account = strings.TrimSpace(folderID), strings.TrimSpace(name), strings.TrimSpace(account)
	if folderID == "" || name == "" || account == "" {
		return false, "", fmt.Errorf("hacen falta folderId, name y account")
	}
	existe, err := s.q.SourceFolderExists(ctx, folderID)
	if err != nil {
		return false, "", err
	}
	if existe {
		return false, "", nil
	}
	branch, err := s.branchOfAccount(ctx, account)
	if err != nil {
		return false, "", err
	}
	if _, err := s.q.CreateSource(ctx, store.CreateSourceParams{
		ID: newID(), Name: name, FolderID: folderID, Type: store.SourceMixed,
		BranchID: &branch, Credential: account,
	}); err != nil {
		return false, "", err
	}
	return true, branch, nil
}
