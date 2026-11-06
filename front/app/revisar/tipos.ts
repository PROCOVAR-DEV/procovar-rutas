/** Una persona de Accesos que puede llevar un GPS. */
export interface Persona {
  authUserId: string;
  name: string;
  email: string;
  branch: string;
  /** La sucursal de Rutas a la que pertenece. Vacío si Accesos y Rutas aún no están enlazados. */
  branchId: string;
  roles: string[];
  /** Si ya tiene ficha aquí. */
  sellerId: string;
}

/** Una carpeta de Drive, que es un teléfono. */
export interface Carpeta {
  id: string;
  name: string;
  folderId: string;
  type: string;
  branch: string;
  branchId: string;
  sellerId: string;
  seller: string;
  files: number;
  lastFile: string;
  daysSilent: number;
  lastError: string;
}
