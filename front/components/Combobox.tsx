"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface Opcion {
  valor: string;
  etiqueta: string;
  /** Texto secundario a la derecha (el rol, la sucursal…). También se busca en él. */
  detalle?: string;
}

const limpio = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Un desplegable con buscador: se escribe y filtra, se elige con el ratón o con flechas y Enter.
 *
 * Con cien personas en la lista, el `<select>` del navegador obliga a recorrerla entera; aquí se
 * escriben tres letras. Sin tildes ni mayúsculas: «sanchez» encuentra «Sánchez».
 */
export default function Combobox({
  opciones,
  valor,
  alElegir,
  placeholder,
  etiqueta,
}: {
  opciones: Opcion[];
  valor: string;
  alElegir: (valor: string) => void;
  placeholder: string;
  /** Para lectores de pantalla. */
  etiqueta: string;
}) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [activa, setActiva] = useState(0);

  const elegida = opciones.find((o) => o.valor === valor);
  const visibles = useMemo(() => {
    const q = limpio(consulta.trim());

    return q ? opciones.filter((o) => limpio(`${o.etiqueta} ${o.detalle ?? ""}`).includes(q)) : opciones;
  }, [opciones, consulta]);

  // Cerrar al pulsar fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) {
        setAbierto(false);
        setConsulta("");
      }
    };

    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  function elegir(o: Opcion) {
    alElegir(o.valor);
    setAbierto(false);
    setConsulta("");
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierto(true);
      setActiva((a) => Math.min(a + 1, visibles.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiva((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && abierto && visibles[activa]) {
      e.preventDefault();
      elegir(visibles[activa]);
    } else if (e.key === "Escape") {
      setAbierto(false);
      setConsulta("");
    }
  }

  return (
    <div className="combo" ref={caja}>
      <input
        ref={entrada}
        className="combo-entrada"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={`${id}-lista`}
        aria-activedescendant={abierto && visibles[activa] ? `${id}-${activa}` : undefined}
        aria-label={etiqueta}
        autoComplete="off"
        placeholder={elegida && !abierto ? elegida.etiqueta : placeholder}
        data-con-valor={Boolean(elegida) && !abierto}
        value={abierto ? consulta : ""}
        onFocus={() => {
          setAbierto(true);
          setActiva(0);
        }}
        onChange={(e) => {
          setConsulta(e.target.value);
          setAbierto(true);
          setActiva(0);
        }}
        onKeyDown={teclas}
      />
      <span className="combo-flecha" aria-hidden>
        ▾
      </span>

      {abierto && (
        <ul className="combo-lista" id={`${id}-lista`} role="listbox">
          {visibles.length === 0 ? (
            <li className="combo-vacio">Nadie coincide con «{consulta}»</li>
          ) : (
            visibles.map((o, i) => (
              <li
                key={o.valor}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.valor === valor}
                data-activa={i === activa}
                className="combo-opcion"
                onMouseEnter={() => setActiva(i)}
                // mousedown y no click: el input pierde el foco antes del click y cerraría la lista.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(o);
                }}
              >
                <span>{o.etiqueta}</span>
                {o.detalle && <span className="combo-detalle">{o.detalle}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
