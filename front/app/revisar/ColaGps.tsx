"use client";

import { useMemo, useState } from "react";
import { borrar, enviar } from "@/lib/api";
import { agruparPorSucursal } from "@/lib/porSucursal";
import { sugerirPersona } from "@/lib/sugerir";
import Combobox from "@/components/Combobox";
import Filtros, { Segmentos } from "./Filtros";
import type { Carpeta, Persona } from "./tipos";

/**
 * Los GPS: cada carpeta de Drive es un teléfono, y lo que hay que hacer es decir de quién es.
 *
 * Una fila por teléfono. Si el nombre de la carpeta dice a quién se parece, se propone con un
 * clic; si no, se busca en la lista de SU sucursal. Al asignar, sus ficheros que estaban
 * esperando se colocan de golpe y los siguientes caen solos.
 */
export default function ColaGps({
  sucursal,
  carpetas,
  personas,
  puedeAsignar,
  puedeQuitar,
  alCambiar,
  avisos,
  children,
}: {
  /** La sucursal elegida en la barra; vacío = todas. */
  sucursal: string;
  carpetas: Carpeta[];
  personas: Persona[];
  puedeAsignar: boolean;
  puedeQuitar: boolean;
  alCambiar: () => void;
  avisos: string[];
  children?: React.ReactNode;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<"todos" | "sin" | "con">("todos");

  const grupos = useMemo(
    () => agruparPorSucursal(carpetas, (g) => g.branch, (g) => g.name),
    [carpetas],
  );
  const delAlcance = sucursal ? carpetas.filter((c) => c.branch === sucursal) : carpetas;
  const q = busqueda.trim().toLowerCase();
  // Se busca por el nombre del GPS y también por quien lo lleva.
  const coincide = (c: Carpeta) =>
    !q || c.name.toLowerCase().includes(q) || c.seller.toLowerCase().includes(q);
  const delEstado = (c: Carpeta) =>
    estado === "todos" || (estado === "sin" ? c.sellerId === "" : c.sellerId !== "");
  const visibles = grupos
    .filter((g) => !sucursal || g.nombre === sucursal)
    .map((g) => ({
      ...g,
      // Lo que falta por asignar, primero; dentro de cada parte, por nombre.
      filas: g.filas
        .filter((c) => delEstado(c) && coincide(c))
        .sort((a, b) => Number(b.sellerId === "") - Number(a.sellerId === "")),
    }))
    .filter((g) => g.filas.length > 0);

  const pendientes = delAlcance.filter((c) => c.sellerId === "").length;
  const total = visibles.reduce((n, g) => n + g.filas.length, 0);

  return (
    <section className="cola">
      <p className="cola-resumen">
        {pendientes === 0
          ? "Todos los GPS tienen dueño."
          : `${pendientes} de ${delAlcance.length} GPS sin dueño. Al asignar uno, sus rutas atrasadas se colocan solas.`}
      </p>

      {avisos.map((a) => (
        <p className="aviso" key={a}>{a}</p>
      ))}

      <Filtros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar un GPS o quien lo lleva"
      >
        <Segmentos
          etiqueta="Qué GPS mostrar"
          valor={estado}
          alElegir={setEstado}
          opciones={[
            { clave: "todos", titulo: "Todos", n: delAlcance.length },
            { clave: "sin", titulo: "Sin dueño", n: pendientes },
            { clave: "con", titulo: "Con dueño", n: delAlcance.length - pendientes },
          ]}
        />
      </Filtros>

      {total === 0 ? (
        <p className="cola-vacia">
          {estado === "sin" && pendientes === 0
            ? "No queda ninguno por asignar."
            : "Ningún GPS coincide con lo que buscas."}
        </p>
      ) : (
        visibles.map((g) => (
          <div key={g.nombre} className="cola-grupo">
            {sucursal === "" && grupos.length > 1 && (
              <h3 className="cola-grupo-titulo">
                {g.nombre}
                <span className="cola-grupo-n">{g.filas.length}</span>
              </h3>
            )}
            <ul className="lista">
              {g.filas.map((c) => (
                <FilaGps
                  key={c.id}
                  carpeta={c}
                  personas={personas}
                  puedeAsignar={puedeAsignar}
                  puedeQuitar={puedeQuitar}
                  alCambiar={alCambiar}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {children}
    </section>
  );
}

function FilaGps({
  carpeta,
  personas,
  puedeAsignar,
  puedeQuitar,
  alCambiar,
}: {
  carpeta: Carpeta;
  personas: Persona[];
  puedeAsignar: boolean;
  puedeQuitar: boolean;
  alCambiar: () => void;
}) {
  const [cambiando, setCambiando] = useState(false);
  const [otra, setOtra] = useState(false);
  const [quien, setQuien] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  // Solo la gente de la sucursal de ESTE teléfono. Si Accesos y Rutas aún no están enlazados
  // para esa sucursal (nadie con su id), se ofrece todo antes que dejar la lista vacía.
  const lista = useMemo(() => {
    const suyas = carpeta.branchId ? personas.filter((p) => p.branchId === carpeta.branchId) : [];

    return suyas.length > 0 ? suyas : personas;
  }, [personas, carpeta.branchId]);
  const sugerida = useMemo(() => sugerirPersona(carpeta.name, lista), [carpeta.name, lista]);

  async function asignar(authUserId: string) {
    const persona = lista.find((p) => p.authUserId === authUserId);

    setTrabajando(true);
    setFallo(null);
    try {
      const r = await enviar<{ placed: number; days: number }>(`/api/gps/${carpeta.id}/asignar`, {
        authUserId,
        name: persona?.name ?? "",
      });

      setHecho(
        r.placed > 0
          ? `Asignado a ${persona?.name ?? "esa persona"} · ${r.placed} ficheros colocados`
          : `Asignado a ${persona?.name ?? "esa persona"}`,
      );
      alCambiar();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  // Dar de baja: lo que ya no sube. Si tiene dueño, se da de baja a la persona en rutas (y todas sus
  // carpetas dejan de barrerse); si no, solo la carpeta. El histórico se conserva y deja de salir como «va a subir».
  async function darDeBaja() {
    const aviso = carpeta.sellerId
      ? `¿Dar de baja de rutas a ${carpeta.seller}? Dejará de salir como «va a subir» y sus carpetas no se barrerán. Lo que ya subió se conserva.`
      : `¿Dar de baja la carpeta «${carpeta.name}»? Deja de barrerse y sale de esta lista. Lo que ya subió se conserva.`;

    if (!window.confirm(aviso)) return;
    setTrabajando(true);
    setFallo(null);
    try {
      if (carpeta.sellerId) await enviar(`/api/sellers/${carpeta.sellerId}/baja`, {});
      else await borrar(`/api/sources/${carpeta.id}`);
      alCambiar();
    } catch (e) {
      setFallo((e as Error).message);
      setTrabajando(false);
    }
  }

  // Desvincular: quitarle el dispositivo a su persona. La carpeta se queda, sin dueño.
  async function desvincular() {
    if (!window.confirm(`¿Quitarle «${carpeta.name}» a ${carpeta.seller}? El GPS queda sin dueño; lo que ya subió se queda con ${carpeta.seller}.`)) return;
    setTrabajando(true);
    setFallo(null);
    try {
      await enviar(`/api/gps/${carpeta.id}/desvincular`, {});
      alCambiar();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  const sinDueno = carpeta.sellerId === "";
  const callado = carpeta.daysSilent > 3;

  return (
    <li className="gps" data-sin-dueno={sinDueno}>
      <div className="gps-datos">
        <b className="gps-nombre">{carpeta.name}</b>
        <span className="gps-meta">
          {carpeta.files} rutas · {carpeta.lastFile ? `última ${carpeta.lastFile}` : "nunca ha subido"}
          {callado && <span className="gps-callado">{carpeta.daysSilent} días sin subir</span>}
        </span>
        {carpeta.lastError && <span className="gps-error">{carpeta.lastError}</span>}
      </div>

      <div className="gps-dueno">
        {hecho ? (
          <span className="gps-hecho">{hecho}</span>
        ) : !sinDueno && !cambiando ? (
          <>
            <span className="gps-persona">{carpeta.seller}</span>
            {puedeAsignar && (
              <>
                <button className="pv-boton-texto" onClick={() => setCambiando(true)}>
                  Cambiar
                </button>
                <button className="pv-boton-texto" disabled={trabajando} onClick={desvincular}>
                  Desvincular
                </button>
              </>
            )}
          </>
        ) : !puedeAsignar ? (
          <span className="sub">sin asignar</span>
        ) : lista.length === 0 ? (
          <span className="sub">no hay gente de esta sucursal en Accesos</span>
        ) : sugerida && !otra ? (
          <>
            <span className="gps-sugerencia">
              ¿Es <b>{sugerida.name}</b>?
            </span>
            <button
              className="pv-boton pv-boton-primario pv-boton-corto"
              disabled={trabajando}
              onClick={() => asignar(sugerida.authUserId)}
            >
              {trabajando ? "…" : "Sí, asignar"}
            </button>
            <button className="pv-boton-texto" onClick={() => setOtra(true)}>
              Otra persona
            </button>
          </>
        ) : (
          <>
            <Combobox
              etiqueta={`¿De quién es ${carpeta.name}?`}
              placeholder="Buscar persona…"
              valor={quien}
              alElegir={setQuien}
              opciones={lista.map((p) => ({
                valor: p.authUserId,
                etiqueta: p.name || p.email,
                detalle: p.roles.join(", ").toLowerCase(),
              }))}
            />
            <button
              className="pv-boton pv-boton-primario pv-boton-corto"
              disabled={!quien || trabajando}
              onClick={() => asignar(quien)}
            >
              {trabajando ? "…" : "Asignar"}
            </button>
            {(cambiando || otra) && (
              <button
                className="pv-boton-texto"
                onClick={() => {
                  setCambiando(false);
                  setOtra(false);
                }}
              >
                Cancelar
              </button>
            )}
          </>
        )}
        {fallo && <span className="gps-error">{fallo}</span>}
      </div>

      {puedeQuitar && !hecho && (
        <button className="pv-boton-texto gps-quitar" disabled={trabajando} onClick={darDeBaja}>
          Dar de baja
        </button>
      )}
    </li>
  );
}
