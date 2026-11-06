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
