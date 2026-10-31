package store

import "context"

const failedFiles = `SELECT drive_file_id FROM gpx_file WHERE drive_file_id = ANY($1::text[]) AND estado = 'ERROR'`

// De esta lista, cuáles se importaron con error (XML ilegible, etc.). La ingesta los
// aparta a «GPS Errores» de SU carpeta en vez de dejarlos mezclados con los buenos.
func (q *Queries) FailedFiles(ctx context.Context, ids []string) ([]string, error) {
	rows, err := q.db.Query(ctx, failedFiles, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		items = append(items, id)
	}
	return items, rows.Err()
}
