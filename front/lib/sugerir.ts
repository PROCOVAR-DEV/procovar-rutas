/**
 * ¿De quién es este GPS? Una sugerencia a partir del nombre de la carpeta.
 *
 * La carpeta se llama como el perfil del teléfono —«GPS Diana Acosta», «Niurbelis Sánchez»,
 * «STGGari»— y casi siempre lleva el nombre de quien lo lleva. Si el nombre cuadra con UNA
 * persona, se le propone con un clic; si cuadra con dos o con ninguna, no se propone nada:
 * una sugerencia equivocada que se acepta de memoria es peor que no tenerla.
 */

export interface PersonaSugerible {
  authUserId: string;
  name: string;
  email: string;
}

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Lo que acompaña al nombre en una carpeta y no dice de quién es.
const RUIDO = new Set([
  "gps", "tablet", "tab", "supervisor", "supervisora", "nuevo", "nueva", "vendedor", "ps",
  "cam", "gr", "gto", "hab", "hol", "tun", "ss", "stg", "gtm", "bay", "moa", "pls",
]);

const palabras = (s: string) =>
  sinTildes(s)
    .split(/[^a-z]+/)
    .filter((p) => p.length >= 3 && !RUIDO.has(p));

/** Sale cuando la carpeta nombra a una sola persona de la lista; si no, null. */
export function sugerirPersona<T extends PersonaSugerible>(carpeta: string, personas: T[]): T | null {
  const buscadas = palabras(carpeta);

  if (buscadas.length === 0) return null;

  const candidatas = personas.filter((p) => {
    const suyas = [...palabras(p.name), ...palabras(p.email.split("@")[0] ?? "")];

    // Cada palabra de la carpeta tiene que ser el principio de una de las suyas (o al revés):
    // «niurbelis» y «niurbelis», «yoan» y «yoan.dominguez».
    return buscadas.every((b) => suyas.some((x) => x.startsWith(b) || b.startsWith(x)));
  });

  return candidatas.length === 1 ? candidatas[0] : null;
}
