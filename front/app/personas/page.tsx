"use client";

/**
 * Personas: TODA la gente de Accesos en una sola vista, con lo suyo al lado.
 *
 * La persona de Accesos es el pivote: de ella cuelgan su GPS (la carpeta de Drive que sube sus
 * rutas) y su vendedor de PEDIDO (de donde vienen sus pedidos y clientes). Aquí se ve quién tiene
 * las dos cosas, quién sube, y a quién le falta algo — y se completa desde la misma fila.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Combobox from "@/components/Combobox";
import SinPermiso from "@/components/SinPermiso";
import { useSesion, useSucursal } from "@/components/Sesion";
import { ask, enviar } from "@/lib/api";
import { sugerirGps, vendedoresDe } from "@/lib/sugerir";
import Filtros, { Segmentos } from "../revisar/Filtros";
import type { Carpeta, Persona } from "../revisar/tipos";

interface Vendedor {
  ref: string;
  code: string;
  name: string;
  branch: string;
  branchId: string;
  orders: number;
  sellerId: string;
}

interface Callado {
  sellerId: string;
  lastUpload: string | null;
  daysSilent: number;
}

interface Resumen {
  vendors: Vendedor[] | null;
  silent: Callado[];
}

type Estado = "todos" | "completos" | "incompletos";

export default function Personas() {
  const { cargando, vetado, puede } = useSesion();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<Estado>("todos");

  const cargar = useCallback(() => {
    ask<Persona[]>("/api/personas").then((p) => setPersonas(p ?? [])).catch((e) => setError((e as Error).message));
    ask<Carpeta[]>("/api/gps").then((g) => setCarpetas(g ?? [])).catch(() => setCarpetas([]));
    ask<Resumen>("/api/review").then(setResumen).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(cargar, [cargar]);

  // El nombre de cada sucursal tal como lo llama Rutas (Bayamo), no como Accesos (Granma): el
  // selector de la barra es el mismo en todas las pantallas.
  const nombreDeSucursal = useMemo(() => {
    const m = new Map<string, string>();

    carpetas.forEach((c) => c.branchId && m.set(c.branchId, c.branch));
    (resumen?.vendors ?? []).forEach((v) => v.branchId && !m.has(v.branchId) && m.set(v.branchId, v.branch));
    return m;
  }, [carpetas, resumen]);
  const sucursalDe = (p: Persona) => nombreDeSucursal.get(p.branchId) ?? p.branch;

  const sucursal = useSucursal(
    Array.from(new Set(personas.map(sucursalDe).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
  );

  if (cargando) return <p className="cargando">Cargando…</p>;
  if (vetado) return <SinPermiso que="Rutas" detalle={vetado.replace("sin permiso: ", "")} />;
  if (!puede("rutas.alias")) return <SinPermiso que="esta pantalla" detalle="rutas.alias" />;
  if (error) return <p className="aviso">{error}</p>;
  if (!resumen) return <p className="cargando">Cargando…</p>;

  const vendedores = resumen.vendors ?? [];
  const filas = personas
    .filter((p) => !sucursal || sucursalDe(p) === sucursal)
    .map((p) => {
      const ficha = p.sellerId;
      const gps = ficha ? carpetas.filter((c) => c.sellerId === ficha) : [];
      const suyos = ficha ? vendedores.filter((v) => v.sellerId === ficha) : [];
      const sube = ficha ? resumen.silent.find((s) => s.sellerId === ficha) : undefined;

      return { p, gps, suyos, sube, completo: gps.length > 0 && suyos.length > 0 };
    });

  const q = busqueda.trim().toLowerCase();
  const visibles = filas
    .filter(
      (f) =>
        (estado === "todos" || (estado === "completos" ? f.completo : !f.completo)) &&
        (!q ||
          f.p.name.toLowerCase().includes(q) ||
          f.p.email.toLowerCase().includes(q) ||
          f.gps.some((g) => g.name.toLowerCase().includes(q)) ||
          f.suyos.some((v) => v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q))),
    )
    .sort((a, b) => Number(a.completo) - Number(b.completo) || a.p.name.localeCompare(b.p.name));
  const completos = filas.filter((f) => f.completo).length;

  return (
    <>
      <header className="bandeja-cabecera">
        <h1>Personas</h1>
        <p className="sub">
          La gente de Accesos con su GPS y su vendedor de PEDIDO. Lo que falta se completa desde la misma fila.
        </p>
      </header>

      <section className="cola">
        <p className="cola-resumen">
          {filas.length - completos === 0
            ? "Todos tienen su GPS y su vendedor de PEDIDO."
            : `${filas.length - completos} de ${filas.length} personas tienen algo por completar.`}
        </p>

        <Filtros
          busqueda={busqueda}
          alBuscar={setBusqueda}
          placeholder="Buscar por nombre, usuario, GPS o vendedor"
        >
          <Segmentos
            etiqueta="Qué personas mostrar"
            valor={estado}
            alElegir={setEstado}
            opciones={[
              { clave: "todos", titulo: "Todas", n: filas.length },
              { clave: "incompletos", titulo: "Por completar", n: filas.length - completos },
              { clave: "completos", titulo: "Completas", n: completos },
            ]}
          />
        </Filtros>

        {visibles.length === 0 ? (
          <p className="cola-vacia">Nadie coincide con lo que buscas.</p>
        ) : (
          <ul className="lista">
            {visibles.map((f) => (
              <FilaPersona
                key={f.p.authUserId}
                f={f}
                sucursal={sucursalDe(f.p)}
                libres={carpetas.filter((c) => c.sellerId === "" && c.branchId === f.p.branchId)}
                sinPar={vendedores.filter((v) => v.sellerId === "" && (!v.branchId || v.branchId === f.p.branchId))}
                alCambiar={cargar}
              />
            ))}
          </ul>
        )}

      {(() => {
        const huerfanos = vendedores.filter((v) => v.sellerId === "" && (!sucursal || v.branch === sucursal));

        return huerfanos.length > 0 ? (
          <details className="huerfanos">
            <summary>
              {huerfanos.length} vendedores de PEDIDO no casan con nadie de Accesos
            </summary>
            <p className="sub">
              Su código y su nombre no coinciden con ningún usuario. Si son personas que siguen, se enlazan desde la
              fila de su usuario; si ya no están, no hay nada que hacer aquí.
            </p>
            <ul className="huerfanos-lista">
              {huerfanos.map((v) => (
                <li key={v.ref}>
                  <b>{v.name}</b> <span className="gps-meta">{v.code} · {v.branch} · {v.orders} pedidos</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null;
      })()}
      </section>
    </>
  );
}

function FilaPersona({
  f,
  sucursal,
  libres,
  sinPar,
  alCambiar,
}: {
  f: { p: Persona; gps: Carpeta[]; suyos: Vendedor[]; sube?: Callado; completo: boolean };
  sucursal: string;
  libres: Carpeta[];
  sinPar: Vendedor[];
  alCambiar: () => void;
}) {
  const { p } = f;
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [gpsElegido, setGpsElegido] = useState("");
  const [vendedorElegido, setVendedorElegido] = useState("");

  // Lo que se le sugiere: un solo GPS libre o un solo vendedor sin enlazar que cuadre con su nombre.
  const gpsSugerido = useMemo(
    () => sugerirGps({ name: p.name, code: p.email.split("@")[0] ?? "" }, libres),
    [p, libres],
  );
  const posibles = useMemo(() => vendedoresDe(p, sinPar), [p, sinPar]);
  const vendedorSugerido = posibles.length === 1 ? posibles[0] : null;

  async function accion(hacer: () => Promise<unknown>) {
    setTrabajando(true);
    setFallo(null);
    try {
      await hacer();
      alCambiar();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  const asignarGps = (id: string) =>
    accion(() => enviar(`/api/gps/${id}/asignar`, { authUserId: p.authUserId, name: p.name }));
  const emparejar = (v: Vendedor) =>
    accion(() =>
      enviar("/api/pedidos/emparejar", {
        vendorCode: v.code,
        vendorName: v.name,
        authUserId: p.authUserId,
        branchId: v.branchId || p.branchId,
        name: p.name,
      }),
    );

  const desvincular = (g: Carpeta) => {
    if (!window.confirm(`¿Quitarle «${g.name}» a ${p.name}? El GPS queda sin dueño; lo que ya subió se queda con ${p.name}.`)) return;
    accion(() => enviar(`/api/gps/${g.id}/desvincular`, {}));
  };
  const darDeBaja = () => {
    if (!window.confirm(`¿Dar de baja de rutas a ${p.name}? Dejará de salir como «va a subir» y sus GPS no se barrerán. Lo que ya subió se conserva.`)) return;
    accion(() => enviar(`/api/sellers/${p.sellerId}/baja`, {}));
  };

  const dias = f.sube ? f.sube.daysSilent : null;

  return (
    <li className="persona" data-completo={f.completo}>
      <div className="persona-quien">
        <b className="gps-nombre">{p.name || p.email}</b>
        <span className="gps-meta">
          {sucursal} · {p.roles.join(", ").toLowerCase() || "sin rol"}
          {dias !== null && dias > 3 && <span className="gps-callado">{dias < 0 ? "nunca ha subido" : `${dias} días sin subir`}</span>}
        </span>
      </div>

      <div className="persona-celda">
        <span className="persona-rotulo">GPS</span>
        {f.gps.length > 0 ? (
          f.gps.map((g) => (
            <span key={g.id} className="persona-valor">
              {g.name}
              <span className="gps-meta"> · {g.lastFile ? `última ${g.lastFile}` : "nunca ha subido"}</span>
              <button className="pv-boton-texto" disabled={trabajando} onClick={() => desvincular(g)}>
                Desvincular
              </button>
            </span>
          ))
        ) : gpsSugerido ? (
          <span className="persona-accion">
            ¿Es <b>{gpsSugerido.name}</b>?
            <button className="pv-boton pv-boton-primario pv-boton-corto" disabled={trabajando} onClick={() => asignarGps(gpsSugerido.id)}>
              Sí, asignar
            </button>
          </span>
        ) : libres.length > 0 ? (
          <span className="persona-accion">
            <Combobox
              etiqueta={`GPS de ${p.name}`}
              placeholder="Elegir GPS…"
              valor={gpsElegido}
              alElegir={setGpsElegido}
              opciones={libres.map((c) => ({ valor: c.id, etiqueta: c.name }))}
            />
            <button className="pv-boton pv-boton-primario pv-boton-corto" disabled={!gpsElegido || trabajando} onClick={() => asignarGps(gpsElegido)}>
              Asignar
            </button>
          </span>
        ) : (
          <span className="sub">sin GPS libre</span>
        )}
      </div>

      <div className="persona-celda">
        <span className="persona-rotulo">PEDIDO</span>
        {f.suyos.length > 0 ? (
          f.suyos.map((v) => (
            <span key={v.ref} className="persona-valor">
              {v.code}
              <span className="gps-meta"> · {v.orders} pedidos</span>
            </span>
          ))
        ) : vendedorSugerido ? (
          <span className="persona-accion">
            ¿Es <b>{vendedorSugerido.code}</b>?
            <button className="pv-boton pv-boton-primario pv-boton-corto" disabled={trabajando} onClick={() => emparejar(vendedorSugerido)}>
              Sí, enlazar
            </button>
          </span>
        ) : sinPar.length > 0 ? (
          <span className="persona-accion">
            <Combobox
              etiqueta={`Vendedor de PEDIDO de ${p.name}`}
              placeholder="Elegir vendedor…"
              valor={vendedorElegido}
              alElegir={setVendedorElegido}
              opciones={sinPar.map((v) => ({ valor: v.ref, etiqueta: v.name, detalle: v.code }))}
            />
            <button
              className="pv-boton pv-boton-primario pv-boton-corto"
              disabled={!vendedorElegido || trabajando}
              onClick={() => {
                const v = sinPar.find((x) => x.ref === vendedorElegido);

                if (v) emparejar(v);
              }}
            >
              Enlazar
            </button>
          </span>
        ) : (
          <span className="sub">sin vendedor libre</span>
        )}
      </div>

      {p.sellerId && (
        <div className="persona-pie">
          <button className="pv-boton-texto" disabled={trabajando} onClick={darDeBaja}>
            Dar de baja de rutas
          </button>
        </div>
      )}

      {fallo && <span className="gps-error persona-fallo">{fallo}</span>}
    </li>
  );
}
