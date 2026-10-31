package ingest

import (
	"context"
	"log/slog"
	"time"
)

// EsperarRedis insiste hasta que Redis conteste, y devuelve false solo si se cancela.
//
// POR QUÉ NO BASTA UN PING AL ARRANCAR. El 23/10/2026 el servidor se reinició y la
// ingesta arrancó antes de que la red de Docker resolviera el nombre de Redis
// («lookup procovar-redis-…: no such host»). El código hacía UN ping, vio el fallo y
// siguió SIN consumidor de la cola: el contenedor quedó «sano», sin hacer nada, y nada
// entró durante una semana. Una dependencia que tarda treinta segundos en estar
// lista no es una dependencia ausente.
func EsperarRedis(ctx context.Context, ping func(context.Context) error, cada time.Duration, log *slog.Logger) bool {
	avisado := false
	for {
		err := ping(ctx)
		if err == nil {
			if avisado {
				log.Info("Redis ya responde; arranca el consumidor de la cola")
			}
			return true
		}
		if ctx.Err() != nil {
			return false
		}
		// Se avisa una vez, no en cada intento: serían 17.000 líneas al día.
		if !avisado {
			log.Warn("Redis no responde; se sigue intentando y el consumidor arranca en cuanto conteste", "error", err)
			avisado = true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(cada):
		}
	}
}
