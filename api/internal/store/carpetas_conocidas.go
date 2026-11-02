package store

import "context"

// Todas las carpetas que el panel conoce, ACTIVAS O NO. Una que una persona desactivó (p. ej. la
// carpeta de errores de pedidos que alguien dio de alta por error) sigue siendo «conocida»: el
// descubrimiento automático no debe volver a darla de alta.
func (q *Queries) AllSourceFolderIDs(ctx context.Context) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT folder_id FROM drive_source`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (q *Queries) SourceFolderExists(ctx context.Context, folderID string) (bool, error) {
	var existe bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM drive_source WHERE folder_id = $1)`, folderID).Scan(&existe)
	return existe, err
}
