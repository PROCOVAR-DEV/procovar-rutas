"use client";

/**
 * Quién entró, qué puede, y la salida.
 *
 * Se pregunta UNA vez, al cargar la aplicación, y de ahí vive todo lo demás: el
 * menú esconde lo que esa persona no tiene y cada pantalla sabe si le toca. No se
 * va a Accesos en cada clic — los permisos vienen con la sesión y no cambian
 * mientras se está dentro.
 *
 * Que la pantalla esconda cosas es comodidad, no seguridad: la API exige la llave
 * en cada ruta y contesta 403 aunque alguien escriba la dirección a mano. Lo de
 * aquí es para que nadie vea botones que no puede usar.
 *
 * Cerrar sesión no se resuelve aquí: se va a Accesos, que es donde vive la sesión,
 * donde está el "¿seguro?" y donde de verdad se cierra. Un panel que solo borrara
 * su galleta estaría mintiendo.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { API, ask, ApiError, type Yo } from "@/lib/api";

interface Estado {
  yo: Yo | null;
  cargando: boolean;
  /** Si la sesión existe pero no puede ni entrar, la llave que le falta. */
  vetado: string | null;
  puede: (clave: string) => boolean;
  /** Las sucursales que la pantalla de ahora tiene a la vista. Con más de una sale el selector arriba. */
  sucursales: string[];
  /** La elegida; vacío = todas. Solo vale si sigue entre las que hay a la vista. */
  sucursal: string;
  ofrecerSucursales: (nombres: string[]) => void;
  elegirSucursal: (nombre: string) => void;
}

const Contexto = createContext<Estado>({
  yo: null,
  cargando: true,
  vetado: null,
  puede: () => false,
  sucursales: [],
  sucursal: "",
  ofrecerSucursales: () => {},
  elegirSucursal: () => {},
});

export const useSesion = () => useContext(Contexto);

const CLAVE_SUCURSAL = "rutas.sucursal";

/**
 * La sucursal que se está mirando, la misma en todas las pantallas.
 *
 * Quien ve varias sucursales tiene un selector arriba y elige una (o todas); quien solo ve una no
 * tiene selector y ve esa. La pantalla dice qué sucursales tiene a la vista con `ofrecer` y filtra
 * por `sucursal`; el selector aparece solo si hay más de una que elegir.
 */
export function useSucursal(nombres: string[]) {
  const { sucursal, ofrecerSucursales } = useContext(Contexto);
  const clave = nombres.join("|");

  useEffect(() => {
    ofrecerSucursales(clave ? clave.split("|") : []);
  }, [clave, ofrecerSucursales]);

  return sucursal;
}

export function Sesion({ children }: { children: React.ReactNode }) {
  const [yo, setYo] = useState<Yo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vetado, setVetado] = useState<string | null>(null);
  const [sucursales, setSucursales] = useState<string[]>([]);
  const [elegida, setElegida] = useState("");

  // Lo elegido se recuerda en el navegador: quien lleva dos sucursales no la vuelve a elegir
  // cada mañana.
  useEffect(() => {
    try {
      setElegida(window.localStorage.getItem(CLAVE_SUCURSAL) ?? "");
    } catch {
      /* sin almacenamiento: se empieza viendo todas */
    }
  }, []);

  const ofrecerSucursales = useCallback((nombres: string[]) => {
    setSucursales((antes) => (antes.join("|") === nombres.join("|") ? antes : nombres));
  }, []);

  const elegirSucursal = (nombre: string) => {
    setElegida(nombre);
    try {
      window.localStorage.setItem(CLAVE_SUCURSAL, nombre);
    } catch {
      /* se pierde la preferencia, no la pantalla */
    }
  };

  useEffect(() => {
    ask<Yo>("/api/me")
      .then((quien) => {
        setYo(quien);
        setCargando(false);
      })
      .catch((e) => {
        // 401: no hay sesión. `ask` ya mandó el navegador a Accesos, así que aquí NO
        // se deja de cargar a propósito.
        //
        // Si se dejara, la pantalla se pinta durante el segundo que tarda la
        // navegación — y como sin sesión `puede()` es falso para todo, lo que se pinta
        // es "No tienes permiso para ver el calendario". Quien lo ve entiende que le
        // falta un permiso, cuando lo que le falta es entrar. Dos problemas muy
        // distintos con la misma cara: uno se arregla pidiéndoselo al administrador y
        // el otro tecleando la contraseña.
        if (e instanceof ApiError && e.status === 401) return;

        // 403 con sesión buena: entró, pero esta aplicación no es suya. Se guarda la
        // llave que falta para poder decírselo, en vez de dejar la pantalla muda.
        if (e instanceof ApiError && e.status === 403) setVetado(e.message);
        setCargando(false);
      });
  }, []);

  const puede = (clave: string) => Boolean(yo?.permisos?.[clave]);

  return (
    <Contexto.Provider
      value={{
        yo,
        cargando,
        vetado,
        puede,
        sucursales,
        sucursal: sucursales.includes(elegida) ? elegida : "",
        ofrecerSucursales,
        elegirSucursal,
      }}
    >
      <header className="barra">
        <Link href="/" className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Procovar" width={150} height={30} className="marca-logo" />
          <span className="marca-app">Rutas</span>
        </Link>

        {/* Un solo enlace, porque hay una sola pantalla.
            Había tres —Calendario, Bandeja y Administración— y las dos últimas eran
            listas a las que nadie entraba: lo suyo (qué fichero llegó sin dueño, qué
            vendedor lleva días sin subir) es la EXPLICACIÓN de un hueco del
            calendario, y puesto en otra pestaña se queda sin leer. Ahora sale encima
            de la cuadrícula, y solo cuando hay algo que hacer.
            El reporte imprimible no va aquí: necesita un vendedor y un día, así que
            se entra desde el recorrido, que es donde se sabe cuáles. */}
        <nav>
          {puede("rutas.calendario") && <Link href="/">Calendario</Link>}
          {/* Y el detalle de lo que falta, que es a donde se va CUANDO hay algo que
              arreglar. Está en el menú y no solo colgando del calendario porque se
              entra a propósito: «voy a ver qué ficheros hay que volver a subir». */}
          {puede("rutas.calendario") && <Link href="/revisar">Revisar</Link>}
          {puede("rutas.alias") && <Link href="/personas">Personas</Link>}
        </nav>

        {/* Cerrar sesión sale SIEMPRE, aunque no se sepa quién es o no tenga
            permisos. Esto se abre en la computadora de la sucursal, que usa más de
            una persona: quien no pueda salir se levanta creyendo que salió, y el
            siguiente se encuentra la sesión abierta. */}
        {/* Solo si hay más de una sucursal que elegir: quien ve una sola ve esa y no tiene botón. */}
        {sucursales.length > 1 && (
          <label className="barra-sucursal">
            <span className="barra-sucursal-rotulo">Sucursal</span>
            <select
              value={sucursales.includes(elegida) ? elegida : ""}
              onChange={(e) => elegirSucursal(e.target.value)}
              aria-label="Sucursal que se está viendo"
            >
              <option value="">Todas</option>
              {sucursales.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="sesion">
          {yo && (
            <span className="sesion-quien">
              {yo.user}
              <span className="sesion-rol">{yo.role}</span>
            </span>
          )}
          <a href={`${API}/api/auth/logout`} className="sesion-salir">
            Cerrar sesión
          </a>
        </div>
      </header>

      <main>{children}</main>
    </Contexto.Provider>
  );
}
