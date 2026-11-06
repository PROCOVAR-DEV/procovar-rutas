"use client";

/**
 * Qué hay que revisar.
 *
 * # Por qué esto no está en el calendario
 *
 * El calendario es una cuadrícula de vendedores por días y se abre para una sola
 * cosa: ver de un vistazo quién trabajó y quién no. Poner ahí encima los treinta y
 * seis que llevan días sin subir, más los ficheros ilegibles con su error de XML,
 * lo convertía en un muro de texto que hay que atravesar para llegar a lo que se
 * venía a ver — y encima con el detalle a medias, porque ahí no cabe.
 *
 * Aquí sí cabe, y esto es lo que se necesita para ARREGLARLO: qué fichero falló, de
 * qué carpeta salió, de qué día es y qué dijo el error, para poder ir a subirlo otra
 * vez a mano. Quién lleva sin subir y desde cuándo. Y quién es quién con PEDIDO,
 * tanto lo que ya está atado como lo que falta.
 *
 * El calendario se queda con una línea que dice cuántas cosas hay y trae aquí.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import SinPermiso from "@/components/SinPermiso";
import { useSesion, useSucursal } from "@/components/Sesion";
import { agruparPorSucursal } from "@/lib/porSucursal";
import { sugerirGps } from "@/lib/sugerir";
import ColaGps from "./ColaGps";
import Filtros, { Segmentos } from "./Filtros";
import type { Carpeta, Persona } from "./tipos";
import { useEvents } from "@/lib/events";
import { ask, enviar } from "@/lib/api";

interface FicheroAtascado {
  id: string;
  name: string;
  source: string;
  folderPath: string | null;
  seller: string;
  status: string;
  error: string | null;
  date: string | null;
  points: number;
  importedAt: string;
}

interface VendedorCallado {
  sellerId: string;
  branchName: string;
  seller: string;
  lastUpload: string | null;
  daysSilent: number;
  stuckFiles: number;
  linked: boolean;
}

/** Un vendedor de PEDIDO y quién es aquí, si ya se dijo. */
interface Vendedor {
  branchId: string;
  ref: string;
  code: string;
  name: string;
  branch: string;
  orders: number;
  /** Vacío = todavía no se sabe quién es aquí. */
  sellerId: string;
  seller: string;
  origin: string;
}

/** Alguien de Accesos: una cuenta de verdad, con su rol. */
interface DiaCortado {
  sellerId: string;
  seller: string;
  date: string;
  file: string;
  detail: string;
  points: number;
}

interface Revision {
  files: FicheroAtascado[];
  truncated?: DiaCortado[];
  silent: VendedorCallado[];
  vendors?: Vendedor[];
  daysMissing?: number;
  queue?: { pendientes: number; haciendose: number; apartados: number };
}

const MOTIVOS: Record<string, string> = {
  SIN_ASIGNAR: "No se supo de quién es",
  SIN_FECHA: "No se pudo fechar",
  ERROR: "No se pudo leer",
};

// Qué hacer con cada motivo. Un error de XML no se arregla desde aquí —hay que
// volver a subir el fichero—, pero uno sin dueño sí.
const QUE_HACER: Record<string, string> = {
  SIN_ASIGNAR: "Dile de quién es y el dispositivo se recuerda para siempre.",
  SIN_FECHA: "Ponle la fecha del día que cubre.",
  ERROR:
    "El fichero está roto o cortado: hay que volver a subirlo a Drive desde el teléfono. " +
    "Aquí no hay nada que asignar.",
};

export default function Revisar() {
  const { cargando, vetado, puede } = useSesion();
  const [datos, setDatos] = useState<Revision | null>(null);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  // Por qué no hay carpetas: «no hay ninguna» y «no se pudieron traer» se veían igual
  // —la pantalla vacía— y son dos problemas distintos.
  const [sinCarpetas, setSinCarpetas] = useState<string | null>(null);
  const [sinAccesos, setSinAccesos] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Qué cola se está mirando; hasta que se elige una, la primera que tenga trabajo.
  const [cola, setCola] = useState<string | null>(null);

  const cargar = useCallback(() => {
    ask<Revision>("/api/review")
      .then(setDatos)
      .catch((e) => setError((e as Error).message));
    ask<Carpeta[]>("/api/gps")
      .then((g) => { setCarpetas(g ?? []); setSinCarpetas(null); })
      .catch((e) => { setCarpetas([]); setSinCarpetas((e as Error).message); });
    // Las personas salen de Accesos, que es donde están las cuentas de verdad. Si no
    // contesta se dice, porque sin esta lista no se puede asignar ningún GPS y hay
    // que saber que el problema no es la pantalla.
    ask<Persona[]>("/api/personas")
      .then((p) => {
        setPersonas(p ?? []);
        setSinAccesos(null);
      })
      .catch((e) => setSinAccesos((e as Error).message));
  }, []);

  useEffect(cargar, [cargar]);

  // Las sucursales que tiene a la vista esta pantalla, para el selector de la barra.
  const nombresSucursal = Array.from(
    new Set([
      ...carpetas.map((c) => c.branch),
      ...(datos?.vendors ?? []).map((v) => v.branch),
      ...(datos?.silent ?? []).map((c) => c.branchName),
    ].filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  const sucursal = useSucursal(nombresSucursal);

  // En vivo: el trabajador va trayendo días y la ingesta va colocando ficheros
  // mientras esta pantalla está abierta. Sin esto habría que recargar para saber si
  // algo avanzó, que es justo la pregunta que se viene a hacer aquí.
  useEvents(["file", "day", "pedidos", "scan"], cargar);

  if (cargando) return <p className="cargando">Cargando…</p>;
  if (vetado) return <SinPermiso que="Rutas" detalle={vetado.replace("sin permiso: ", "")} />;
  if (!puede("rutas.calendario")) return <SinPermiso que="esta pantalla" detalle="rutas.calendario" />;

  if (error) return <p className="aviso">{error}</p>;
  if (!datos) return <p className="cargando">Mirando qué falta…</p>;

  const rotos = datos.files.filter((f) => f.status === "ERROR");
  const colocables = datos.files.filter((f) => f.status !== "ERROR");
  const sinDuenno = (datos.vendors ?? []).filter((v) => v.sellerId === "");
  const sinDueno = carpetas.filter((g) => g.sellerId === "");

  const callados = datos.silent
    .filter((s) => s.daysSilent === -1 || s.daysSilent > 3)
    .sort((a, b) => (b.daysSilent < 0 ? 1e9 : b.daysSilent) - (a.daysSilent < 0 ? 1e9 : a.daysSilent));
  // Las cuentas de las pestañas son las de la sucursal elegida arriba.
  const deLaElegida = (x: { branch: string }) => !sucursal || x.branch === sucursal;
  const truncados = datos.truncated ?? [];
  const nFicheros = rotos.length + colocables.length + truncados.length;

  const colas = [
    ...(puede("rutas.alias")
      ? [{ clave: "gps", titulo: "GPS sin dueño", n: sinDueno.filter(deLaElegida).length }]
      : []),
    ...(puede("rutas.alias") && (datos.vendors?.length ?? 0) > 0
      ? [{ clave: "pedido", titulo: "Vendedores sin emparejar", n: sinDuenno.filter(deLaElegida).length }]
      : []),
    { clave: "sinsubir", titulo: "Sin subir", n: callados.filter((c) => !sucursal || c.branchName === sucursal).length },
    { clave: "ficheros", titulo: "Ficheros con problema", n: nFicheros },
  ];
  const actual = colas.find((c) => c.clave === cola) ?? colas.find((c) => c.n > 0) ?? colas[0];

  return (
    <>
      <header className="bandeja-cabecera">
        <h1>Revisar</h1>
        <p className="sub">Lo que impide que el calendario esté completo. Una cola cada vez.</p>
      </header>

      {/* Cómo va el trabajador de pedidos: explica por qué una pantalla puede estar a medio
          llenar. No está rota, se está poniendo al día. */}
      {(datos.daysMissing ?? 0) > 0 && (
        <p className="banda">
          Poniéndose al día con PEDIDO: faltan <b>{datos.daysMissing}</b> días de clientes
          {datos.queue ? ` (${datos.queue.pendientes} en cola)` : ""}. Va despacio a propósito.
        </p>
      )}

      <nav className="colas" role="tablist" aria-label="Qué revisar">
        {colas.map((c) => (
          <button
            key={c.clave}
            role="tab"
            aria-selected={actual.clave === c.clave}
            className="cola-pestana"
            data-pendiente={c.n > 0}
            onClick={() => setCola(c.clave)}
          >
            <span className="cola-pestana-n">{c.n}</span>
            {c.titulo}
          </button>
        ))}
      </nav>

      {actual.clave === "gps" && (
        <ColaGps
          sucursal={sucursal}
          carpetas={carpetas}
          personas={personas}
          puedeAsignar={puede("rutas.alias")}
          puedeQuitar={puede("rutas.carpeta")}
          alCambiar={cargar}
          avisos={[
            ...(sinAccesos ? [`No se pudo traer la gente de Accesos, así que no se puede asignar nada: ${sinAccesos}`] : []),
            ...(sinCarpetas ? [`No se pudieron traer las carpetas: ${sinCarpetas}`] : []),
          ]}
        >
          {puede("rutas.carpeta") && <NuevaCarpeta alCrear={cargar} />}
        </ColaGps>
      )}

      {actual.clave === "pedido" && (
        <ColaPedido sucursal={sucursal} vendors={datos.vendors ?? []} personas={personas} alEmparejar={cargar} />
      )}

      {actual.clave === "sinsubir" && <ColaSinSubir sucursal={sucursal} callados={callados} />}

      {actual.clave === "ficheros" && (
        <section className="cola">
          {nFicheros === 0 && <p className="cola-vacia">No hay ficheros con problemas.</p>}

          {rotos.length > 0 && (
            <div className="cola-bloque">
              <h3 className="cola-bloque-titulo">
                {rotos.length === 1 ? "Un fichero llegó roto" : `${rotos.length} ficheros llegaron rotos`}
              </h3>
              <p className="sub">
                Llegaron a Drive pero no se pudieron leer. <b>Volver a intentarlo</b> los lee otra
                vez con el lector de hoy; si falla de nuevo, hay que subirlos otra vez desde el
                teléfono.
              </p>
              {rotos.map((f) => (
                <FilaRota key={f.id} fichero={f} alReintentar={cargar} puede={puede("rutas.bandeja")} />
              ))}
            </div>
          )}

          {colocables.length > 0 && (
            <div className="cola-bloque">
              <h3 className="cola-bloque-titulo">
                {colocables.length === 1
                  ? "Un fichero sin colocar"
                  : `${colocables.length} ficheros sin colocar`}
              </h3>
              <p className="sub">
                Al asignarlos se recuerda el dispositivo y los siguientes de ese teléfono se colocan
                solos.
              </p>
              {colocables.map((f) => (
                <FilaFichero key={f.id} fichero={f} personas={personas} alAsignar={cargar} />
              ))}
            </div>
          )}

          {truncados.length > 0 && (
            <div className="cola-bloque">
              <h3 className="cola-bloque-titulo">
                {truncados.length === 1 ? "Un día entró a medias" : `${truncados.length} días entraron a medias`}
              </h3>
              <p className="sub">
                Su fichero se cortó y solo hay el trozo que se pudo leer: <b>sus kilómetros no son
                los de la jornada</b>. Si hace falta el día completo, hay que volver a subir ese
                .gpx.
              </p>
              <div className="tabla-ancha">
                <table className="movements">
                  <thead>
                    <tr>
                      <th>Día</th>
                      <th>Vendedor</th>
                      <th>Fichero</th>
                      <th>Puntos</th>
                      <th>Qué pasó</th>
                    </tr>
                  </thead>
                  <tbody>
                    {truncados.map((d) => (
                      <tr key={`${d.sellerId}:${d.date}`}>
                        <td className="pv-codigo">{d.date}</td>
                        <td>{d.seller}</td>
                        <td className="pv-codigo">{d.file}</td>
                        <td>{d.points}</td>
                        <td className="sub">{d.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** Los vendedores de PEDIDO que aún no son nadie aquí: hasta emparejarlos, sus pedidos no se cruzan con ninguna ruta. */
function ColaPedido({
  sucursal,
  vendors,
  personas,
  alEmparejar,
}: {
  sucursal: string;
  vendors: Vendedor[];
  personas: Persona[];
  alEmparejar: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<"todos" | "sin" | "con">("todos");

  const grupos = agruparPorSucursal(vendors, (v) => v.branch, (v) => v.name);
  const q = busqueda.trim().toLowerCase();
  const visibles = grupos
    .filter((g) => !sucursal || g.nombre === sucursal)
    .map((g) => ({
      ...g,
      filas: g.filas
        .filter(
          (v) =>
            (estado === "todos" || (estado === "sin" ? v.sellerId === "" : v.sellerId !== "")) &&
            (!q ||
              v.name.toLowerCase().includes(q) ||
              v.code.toLowerCase().includes(q) ||
              v.seller.toLowerCase().includes(q)),
        )
        .sort((a, b) => Number(b.sellerId === "") - Number(a.sellerId === "")),
    }))
    .filter((g) => g.filas.length > 0);
  const delAlcance = sucursal ? vendors.filter((v) => v.branch === sucursal) : vendors;
  const pendientes = delAlcance.filter((v) => v.sellerId === "").length;

  return (
    <section className="cola">
      <p className="cola-resumen">
        {pendientes === 0
          ? "Todos los vendedores de PEDIDO están emparejados."
          : `${pendientes} de ${delAlcance.length} vendedores de PEDIDO sin emparejar. Es una vez por vendedor.`}
      </p>

      <Filtros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar por nombre, usuario o GPS"
      >
        <Segmentos
          etiqueta="Qué vendedores mostrar"
          valor={estado}
          alElegir={setEstado}
          opciones={[
            { clave: "todos", titulo: "Todos", n: delAlcance.length },
            { clave: "sin", titulo: "Sin emparejar", n: pendientes },
            { clave: "con", titulo: "Emparejados", n: delAlcance.length - pendientes },
          ]}
        />
      </Filtros>

      {visibles.length === 0 ? (
        <p className="cola-vacia">No hay nada que mostrar con ese filtro.</p>
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
              {g.filas.map((v) => (
                <li className="gps" key={v.ref} data-sin-dueno={v.sellerId === ""}>
                  <div className="gps-datos">
                    <b className="gps-nombre">{v.name}</b>
                    <span className="gps-meta">
                      {v.code} · {v.orders} pedidos
                    </span>
                  </div>
                  <div className="gps-dueno">
                    {v.sellerId ? (
                      <>
                        <span className="gps-persona">{v.seller}</span>
                        <span className="sub">
                          {v.origin === "manual" ? "lo dijo una persona" : "por el nombre"}
                        </span>
                      </>
                    ) : (
                      <ElegirVendedor vendedor={v} personas={personas} alEmparejar={alEmparejar} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** Quién lleva días sin subir: o no lleva el GPS encendido, o dejó de subir. Más de 3 días es un teléfono que hay que ir a mirar. */
function ColaSinSubir({ sucursal, callados: todos }: { sucursal: string; callados: VendedorCallado[] }) {
  const [busqueda, setBusqueda] = useState("");
  const q = busqueda.trim().toLowerCase();
  const callados = sucursal ? todos.filter((c) => c.branchName === sucursal) : todos;
  const filas = callados.filter((c) => !q || c.seller.toLowerCase().includes(q));

  return (
    <section className="cola">
      <p className="cola-resumen">
        {callados.length === 0
          ? "Todos están subiendo."
          : `${callados.length} llevan más de 3 días sin subir una ruta.`}
      </p>

      <Filtros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar un vendedor"
      />

      <ul className="lista">
        {filas.map((c) => (
          <li className="gps" key={c.sellerId} data-sin-dueno={c.daysSilent < 0 || c.daysSilent > 30}>
            <div className="gps-datos">
              <b className="gps-nombre">{c.seller}</b>
              <span className="gps-meta">
                {c.lastUpload ? `última ruta ${c.lastUpload}` : "no ha subido nunca"}
                {c.stuckFiles > 0 && ` · ${c.stuckFiles} ficheros atascados`}
              </span>
            </div>
            <div className="gps-dueno">
              <span className="gps-callado">
                {c.daysSilent < 0 ? "nunca" : `${c.daysSilent} días`}
              </span>
              {!c.linked && <span className="sub">sin emparejar con PEDIDO</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}


function FilaFichero({
  fichero,
  personas,
  alAsignar,
}: {
  fichero: FicheroAtascado;
  /** La gente de Accesos: de ahí se elige. */
  personas: Persona[];
  alAsignar: () => void;
}) {
  const [seller, setVendedor] = useState("");
  const [fecha, setFecha] = useState(fichero.date ?? "");
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function asignar() {
    if (!seller) return;
    const persona = personas.find((p) => p.authUserId === seller);

    setGuardando(true);
    setFallo(null);
    try {
      await enviar("/api/inbox/assign", {
        fileId: fichero.id,
        authUserId: seller,
        branchId: persona?.branchId ?? "",
        personName: persona?.name ?? "",
        fecha: fecha || null,
        rememberAlias: true,
        alias: "",
      });
      alAsignar();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fila-suelta">
      <div>
        <b>{fichero.name}</b>
        <span className="sub">
          {MOTIVOS[fichero.status] ?? fichero.status} · carpeta {fichero.source}
          {fichero.folderPath ? ` / ${fichero.folderPath}` : ""} · {fichero.points} puntos
        </span>
        <span className="sub">{QUE_HACER[fichero.status] ?? ""}</span>
        {fichero.error && <span className="aviso">{fichero.error}</span>}
      </div>
      <div className="controles">
        <select value={seller} onChange={(e) => setVendedor(e.target.value)}>
          <option value="">¿De quién es?</option>
          {personas.map((p) => (
            <option key={p.authUserId} value={p.authUserId}>
              {p.name || p.email}
              {p.branch ? ` · ${p.branch}` : ""}
            </option>
          ))}
        </select>
        <input
          className="pv-campo"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <button
          className="pv-boton pv-boton-primario"
          disabled={!seller || guardando}
          onClick={asignar}
        >
          {guardando ? "Guardando…" : "Asignar"}
        </button>
      </div>
      {fallo && <p className="aviso">{fallo}</p>}
    </div>
  );
}

function ElegirVendedor({
  vendedor,
  personas,
  alEmparejar,
}: {
  vendedor: Vendedor;
  /** La gente de Accesos: de ahí se elige, no de las fichas sueltas de las carpetas de Drive. */
  personas: Persona[];
  alEmparejar: () => void;
}) {
  const [quien, setQuien] = useState("");
  const [otro, setOtro] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  // Solo la gente de la sucursal de este vendedor; si no se sabe cuál es, todos antes que ninguno.
  const lista = useMemo(() => {
    const suyos = vendedor.branchId ? personas.filter((p) => p.branchId === vendedor.branchId) : [];

    return suyos.length > 0 ? suyos : personas;
  }, [personas, vendedor.branchId]);

  // El código del vendedor de PEDIDO ES el usuario de Accesos (georlis.cardenas): casan por nombre y usuario.
  const sugerido = useMemo(() => {
    const candidatas = lista.map((p) => ({ p, name: `${p.name} ${p.email.split("@")[0] ?? ""}` }));

    return sugerirGps(vendedor, candidatas)?.p ?? null;
  }, [vendedor, lista]);

  async function emparejar(authUserId: string) {
    if (!authUserId) return;
    const persona = lista.find((p) => p.authUserId === authUserId);

    setGuardando(true);
    setFallo(null);
    try {
      await enviar("/api/pedidos/emparejar", {
        vendorCode: vendedor.code,
        vendorName: vendedor.name,
        authUserId,
        branchId: vendedor.branchId,
        name: persona?.name ?? "",
      });
      alEmparejar();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (sugerido && !otro) {
    return (
      <>
        <span className="gps-sugerencia">
          ¿Es <b>{sugerido.name}</b>?
        </span>
        <button
          className="pv-boton pv-boton-primario pv-boton-corto"
          disabled={guardando}
          onClick={() => emparejar(sugerido.authUserId)}
        >
          {guardando ? "…" : "Sí, es este"}
        </button>
        <button className="pv-boton-texto" onClick={() => setOtro(true)}>
          Otro
        </button>
        {fallo && <span className="gps-error">{fallo}</span>}
      </>
    );
  }

  if (lista.length === 0) {
    return <span className="sub">no hay gente de esta sucursal en Accesos</span>;
  }

  return (
    <>
      <select
        value={quien}
        onChange={(e) => setQuien(e.target.value)}
        aria-label={`¿Quién es ${vendedor.name} en Accesos?`}
      >
        <option value="">¿Quién es en Accesos?</option>
        {lista.map((p) => (
          <option key={p.authUserId} value={p.authUserId}>
            {p.name || p.email}
            {p.roles.length > 0 ? ` · ${p.roles.join(", ").toLowerCase()}` : ""}
          </option>
        ))}
      </select>
      <button
        className="pv-boton pv-boton-primario pv-boton-corto"
        disabled={!quien || guardando}
        onClick={() => emparejar(quien)}
      >
        {guardando ? "…" : "Es este"}
      </button>
      {otro && (
        <button className="pv-boton-texto" onClick={() => setOtro(false)}>
          Cancelar
        </button>
      )}
      {fallo && <span className="gps-error">{fallo}</span>}
    </>
  );
}

function FilaRota({
  fichero,
  alReintentar,
  puede,
}: {
  fichero: FicheroAtascado;
  alReintentar: () => void;
  puede: boolean;
}) {
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  /**
   * Un fichero que ya NO está en Drive no se puede reintentar.
   *
   * Reintentar es olvidar nuestra nota de «este ya lo vi» para que el siguiente empuje de
   * n8n lo traiga otra vez. Si Drive contesta 404, no hay nada que traer: el botón
   * prometía algo que no puede pasar y quien lo pulsaba se quedaba esperando.
   *
   * Ahí lo único que se puede hacer es quitarlo de la lista, que es la misma operación
   * pero dicha por lo que hace de verdad.
   */
  const noEstaEnDrive = /\b404\b|not found|no encontrado/i.test(fichero.error ?? "");

  async function reintentar() {
    setYendo(true);
    setFallo(null);
    try {
      await enviar(`/api/inbox/${fichero.id}/retry`, {});
      setListo(true);
      alReintentar();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setYendo(false);
    }
  }

  return (
    <div className="fila-suelta">
      <div>
        <b>{fichero.name}</b>
        <span className="sub">
          carpeta {fichero.source}
          {fichero.folderPath ? ` / ${fichero.folderPath}` : ""}
          {fichero.seller ? ` · ${fichero.seller}` : ""}
          {fichero.date ? ` · del ${fichero.date}` : ""} · {fichero.points} puntos
        </span>
        {fichero.error && <span className="aviso">{fichero.error}</span>}
      </div>
      {puede && (
        <div className="controles">
          <button
            className="pv-boton"
            disabled={yendo || listo}
            onClick={reintentar}
            title={
              noEstaEnDrive
                ? "Drive ya no tiene este fichero, así que no hay nada que volver a leer: esto sólo lo quita de la lista."
                : "Olvida nuestra nota de «este ya lo vi» para que n8n lo traiga otra vez y se lea con el lector de hoy."
            }
          >
            {listo
              ? (noEstaEnDrive ? "Quitado" : "Esperando a n8n…")
              : yendo
                ? (noEstaEnDrive ? "Quitando…" : "Olvidando…")
                : (noEstaEnDrive ? "Quitarlo de la lista" : "Volver a intentarlo")}
          </button>
        </div>
      )}
      {noEstaEnDrive && (
        <p className="sub">
          Drive ya no tiene este fichero (404), así que reintentarlo no puede funcionar:
          lo que hay que hacer es volver a subirlo desde el teléfono.
        </p>
      )}
      {fallo && <p className="aviso">{fallo}</p>}
    </div>
  );
}

/**
 * Dar de alta una carpeta nueva.
 *
 * Casi nunca hace falta: las carpetas se dan de alta solas la primera vez que n8n
 * empuja un fichero de ellas. Esto es para el caso en que se comparte una carpeta
 * nueva y se quiere dejar preparada ANTES de que suba nada — con un teléfono recién
 * entregado, así sus primeros días entran ya colocados.
 */
function NuevaCarpeta({ alCrear }: { alCrear: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [folderId, setFolderId] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function crear() {
    if (!nombre || !folderId) return;
    setGuardando(true);
    setFallo(null);
    try {
      await enviar("/api/sources", {
        name: nombre,
        folderId,
        // De un solo vendedor: es lo que es una carpeta de GPS. A quién pertenece se
        // dice después, en la lista de arriba.
        type: "VENDEDOR",
      });
      setNombre("");
      setFolderId("");
      setAbierto(false);
      alCrear();
    } catch (e) {
      setFallo((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button className="pv-boton" style={{ marginTop: "0.75rem" }} onClick={() => setAbierto(true)}>
        Añadir una carpeta nueva
      </button>
    );
  }

  return (
    <div className="fila-suelta" style={{ marginTop: "0.75rem" }}>
      <div>
        <b>Carpeta nueva</b>
        <span className="sub">
          Solo hace falta si quieres dejarla lista ANTES de que suba nada: en cuanto
          n8n empuje su primer fichero, la carpeta se da de alta sola. El
          identificador es el trozo final de su dirección en Drive.
        </span>
      </div>
      <div className="controles">
        <input
          className="pv-campo"
          placeholder="Nombre del perfil del GPS"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <input
          className="pv-campo"
          placeholder="Identificador de la carpeta en Drive"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <button
          className="pv-boton pv-boton-primario"
          disabled={!nombre || !folderId || guardando}
          onClick={crear}
        >
          {guardando ? "Guardando…" : "Añadir"}
        </button>
        <button className="pv-boton" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {fallo && <p className="aviso">{fallo}</p>}
    </div>
  );
}
