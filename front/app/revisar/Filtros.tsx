"use client";

/**
 * La barra de cada cola: buscar por nombre. La sucursal ya no se elige aquí sino arriba, en la
 * barra, y vale para todas las pantallas.
 */
export default function Filtros({
  busqueda,
  alBuscar,
  placeholder,
  children,
}: {
  busqueda: string;
  alBuscar: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="filtros">
      <div className="filtros-fila">
        <input
          type="search"
          className="filtros-buscar"
          value={busqueda}
          onChange={(e) => alBuscar(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {children}
      </div>
    </div>
  );
}

/**
 * «Todos | Sin dueño | Con dueño», con cuántos hay de cada. Antes era una casilla «solo sin dueño»
 * marcada de entrada: lo que ya se asignaba desaparecía y no había forma de volver a verlo para
 * cambiarlo o quitarlo.
 */
export function Segmentos<T extends string>({
  valor,
  alElegir,
  opciones,
  etiqueta,
}: {
  valor: T;
  alElegir: (v: T) => void;
  opciones: { clave: T; titulo: string; n: number }[];
  etiqueta: string;
}) {
  return (
    <div className="segmentos" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.clave}
          type="button"
          className="segmento"
          aria-pressed={valor === o.clave}
          onClick={() => alElegir(o.clave)}
        >
          {o.titulo}
          <span className="segmento-n">{o.n}</span>
        </button>
      ))}
    </div>
  );
}
