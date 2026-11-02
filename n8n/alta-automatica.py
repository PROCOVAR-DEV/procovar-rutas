#!/usr/bin/env python3
"""Flujo «Alta automática de carpetas GPS»: descubre las carpetas de GPS nuevas y las da de alta.

POR QUÉ. Cada perfil de GPS nuevo —o rehecho: al recrearlo, GPSLogger crea una carpeta nueva con el
mismo nombre— había que darlo de alta a mano en Administración, y hasta entonces sus .gpx se quedaban
en Drive sin entrar. El 02/11/2026 había 27 carpetas así en seis sucursales (Brandon, Cristian y Gisela
en La Habana, entre ellas) y nadie lo sabía hasta que la sucursal protestó.

QUÉ HACE, cada 6 horas, con la credencial de cada provincia (la dueña de sus carpetas):
  1. Pregunta al panel qué carpetas conoce (activas o no: una desactivada a propósito no se vuelve a dar de alta).
  2. Lista las carpetas de la cuenta y los .gpx que hay dentro de cada una.
  3. Candidata = carpeta desconocida, con algún .gpx directamente dentro, que no sea de archivo ni de pedidos.
  4. A cada candidata: da permiso de escritura a la cuenta padre (sin él la ingesta no puede leerla ni
     apartar lo procesado) y la registra en el panel (/api/ingest/register-folder, idempotente).
Después, «Crear GPS Procesados y GPS Errores» (cada 6 h) le pone sus dos subcarpetas, y «Ingesta Rutas GPX»
(cada 12 h) baja sus ficheros. Retraso máximo de una carpeta nueva: unas 18 h, sin tocar nada.

Un fallo en una provincia (p. ej. una credencial de Google desactivada) NO para a las demás.

Uso:  RUTAS_SERVICE_KEY=<clave de servicio> python3 alta-automatica.py <clave-api-n8n>
      (la primera vez crea el flujo y lo activa; después lo actualiza en su sitio)
"""
import json
import os
import subprocess
import sys

N8N = "https://n8n.procovar.cloud/api/v1"
RUTAS = "https://rutas.procovar.cloud"
CLAVE = os.environ.get("RUTAS_SERVICE_KEY", "")
DRIVE = "https://www.googleapis.com/drive/v3/files"
ABOUT = "https://www.googleapis.com/drive/v3/about"
CARPETA = "application/vnd.google-apps.folder"
PADRE = {"id": "YHaaPvwunOWiPSIN", "name": "Cuenta padre"}
WORKFLOW = ""  # se rellena tras la primera creación (también se busca por nombre)
NOMBRE = "Alta automática de carpetas GPS"

PROVINCIAS = {
    "Camaguey": "PtjfVbn3s8kIoB1H",
    "Granma": "cQlTlorOaKNu2RSP",
    "Guantanamo": "g5TNh0qpREWnoX3j",
    "Habana": "Xh9UXcYLsDhZwANZ",
    "Holguin": "52A8c5qMws3HltVi",
    "LasTunas": "fHefRFz6HQfXt0Eh",
    "SantiSpiritus": "kXkGLZjFQ2Pu1Q2z",
    "Santiago": "sPEHylrec6dQWsEE",
    # El acceso gXTBf4gP9aNcVwLj de Palma está desactivado («OAuth client was disabled»); este es el del flujo de pedidos.
    "PalmaSoriano": "zU9mKCZZHIghvC3d",
    "Moa": "NFqUFPLVd9EAM1Fg",
}

# Tope por provincia y pasada: un descubrimiento que quisiera dar de alta más que esto es un error de
# estructura del Drive, no un lote de vendedores nuevos, y es mejor que se vea que que se registre a ciegas.
TOPE_ALTAS = 30


def cabecera_servicio():
    return {"sendHeaders": True, "headerParameters": {"parameters": [{"name": "x-api-key", "value": CLAVE}]}}


def http(nombre, x, y, params, cred=None):
    p = {"options": {}}
    if cred:
        p["authentication"] = "predefinedCredentialType"
        p["nodeCredentialType"] = "googleDriveOAuth2Api"
    p.update(params)
    n = {"name": nombre, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
         "position": [x, y], "parameters": p}
    if cred:
        n["credentials"] = {"googleDriveOAuth2Api": {"id": cred[0], "name": cred[1]}}
    # Que una cuenta con la credencial caída no pare a las demás.
    n["onError"] = "continueRegularOutput"
    return n


def consulta(*pares):
    return {"sendQuery": True, "queryParameters": {"parameters": [{"name": k, "value": v} for k, v in pares]}}


# Drive devuelve como mucho 1000 por página: cada página llega como un ítem y se juntan abajo.
PAGINAR = {"pagination": {"pagination": {
    "paginationMode": "updateAParameterInEachRequest",
    "parameters": {"parameters": [{"type": "qs", "name": "pageToken", "value": "={{ $response.body.nextPageToken }}"}]},
    "paginationCompleteWhen": "other",
    "completeExpression": "={{ !$response.body.nextPageToken }}",
    "limitPagesFetched": True,
    "maxRequests": 25,
}}}

LAS_CONOCIDAS = """
// Todas las carpetas que el panel conoce, en un solo ítem.
return [{ json: { ids: $input.all().map(i => i.json.folderId).filter(Boolean) } }];
"""

# Lo que cuenta como candidata. Se prueba en local con datos de mentira (ver abajo).
CANDIDATAS = """
const IGNORAR = /^(gps )?(procesados|error|errores)$|^pedidos$|^visitas$|^untitled folder$|^fotos|^copia|^papelera/i;
const TOPE = %(tope)d;

const conocidas = new Set($('Las conocidas').first().json.ids || []);
const cuenta = (($('Cuenta de %(prov)s').first().json.user) || {}).displayName || '';
const carpetas = $('Carpetas de %(prov)s').all().flatMap(i => i.json.files || []);
const gpx = $input.all().flatMap(i => i.json.files || []);

const cuantos = new Map();
for (const f of gpx) for (const p of (f.parents || [])) cuantos.set(p, (cuantos.get(p) || 0) + 1);

// Sin cuenta no se puede saber de qué sucursal es: mejor no dar de alta nada que darla de alta mal.
if (!cuenta) { console.log('%(prov)s: no se pudo saber la cuenta; no se da de alta nada'); return []; }
// Si Drive falló (credencial caída), tampoco hay nada fiable que decidir.
if (!carpetas.length) { console.log('%(prov)s: sin carpetas (¿credencial caída?)'); return []; }

const nuevas = carpetas
  .filter(c => !conocidas.has(c.id) && (cuantos.get(c.id) || 0) > 0 && !IGNORAR.test((c.name || '').trim()))
  .map(c => ({ json: { provincia: '%(prov)s', cuenta, carpetaId: c.id, carpetaNombre: c.name, gpx: cuantos.get(c.id) } }));

if (nuevas.length > TOPE) {
  console.log(`%(prov)s: ${nuevas.length} candidatas, más que el tope de ${TOPE}: no se da de alta ninguna (revisar a mano)`);
  return [];
}
if (nuevas.length) console.log(`%(prov)s: dando de alta ${nuevas.map(n => n.json.carpetaNombre + ' (' + n.json.gpx + ')').join(', ')}`);
return nuevas;
"""

nodos = [
    {"name": "Cada 6 horas", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [-840, -120],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 */6 * * *"}]}}},
    {"name": "Empezar", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [-840, 40], "parameters": {}},
    # Disparable desde fuera, por si se quiere descubrir ya sin esperar a las 6 h.
    {"name": "Disparar desde fuera", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-840, 200],
     "webhookId": "alta-automatica-gps",
     "parameters": {"path": "alta-automatica-gps", "httpMethod": "POST", "responseMode": "onReceived", "options": {}}},
    http("Quién es el padre", -620, 40, {"url": ABOUT, **consulta(("fields", "user"))}, (PADRE["id"], PADRE["name"])),
    http("Carpetas conocidas", -400, 40, {"url": f"{RUTAS}/api/ingest/folders/all", **cabecera_servicio()}),
    {"name": "Las conocidas", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [-180, 40],
     "parameters": {"mode": "runOnceForAllItems", "jsCode": LAS_CONOCIDAS}},
]

conexiones = {
    "Cada 6 horas": {"main": [[{"node": "Quién es el padre", "type": "main", "index": 0}]]},
    "Empezar": {"main": [[{"node": "Quién es el padre", "type": "main", "index": 0}]]},
    "Disparar desde fuera": {"main": [[{"node": "Quién es el padre", "type": "main", "index": 0}]]},
    "Quién es el padre": {"main": [[{"node": "Carpetas conocidas", "type": "main", "index": 0}]]},
    "Carpetas conocidas": {"main": [[{"node": "Las conocidas", "type": "main", "index": 0}]]},
}

salidas = []
y = -560
for prov, cred in PROVINCIAS.items():
    n_cuenta, n_carp, n_gpx, n_cand, n_perm, n_reg = (
        f"Cuenta de {prov}", f"Carpetas de {prov}", f"GPX de {prov}",
        f"Candidatas {prov}", f"Dar permiso al padre {prov}", f"Registrar {prov}")
    nodos += [
        http(n_cuenta, 60, y, {"url": ABOUT, **consulta(("fields", "user"))}, cred=(cred, prov)),
        http(n_carp, 280, y, {"url": DRIVE, "options": PAGINAR, **consulta(
            ("q", f"'me' in owners and mimeType='{CARPETA}' and trashed=false"),
            ("fields", "nextPageToken,files(id,name)"),
            ("pageSize", "1000"))}, cred=(cred, prov)),
        http(n_gpx, 500, y, {"url": DRIVE, "options": PAGINAR, **consulta(
            ("q", "'me' in owners and name contains '.gpx' and trashed=false"),
            ("fields", "nextPageToken,files(id,parents)"),
            ("pageSize", "1000"))}, cred=(cred, prov)),
        {"name": n_cand, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [720, y],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": CANDIDATAS % {"prov": prov, "tope": TOPE_ALTAS}}},
        http(n_perm, 940, y, {
            "method": "POST",
            "url": "={{ 'https://www.googleapis.com/drive/v3/files/' + $json.carpetaId + '/permissions' }}",
            **consulta(("sendNotificationEmail", "false"), ("supportsAllDrives", "true")),
            "sendBody": True, "specifyBody": "json",
            "jsonBody": ("={{ JSON.stringify({ role: 'writer', type: 'user', "
                         "emailAddress: $('Quién es el padre').first().json.user.emailAddress }) }}"),
            "options": {"response": {"response": {"neverError": True}}},
        }, cred=(cred, prov)),
        http(n_reg, 1160, y, {
            "method": "POST", "url": f"{RUTAS}/api/ingest/register-folder", **cabecera_servicio(),
            "sendBody": True, "specifyBody": "json",
            "jsonBody": ("={{ JSON.stringify({ folderId: $('" + n_cand + "').item.json.carpetaId, "
                         "name: $('" + n_cand + "').item.json.carpetaNombre, "
                         "account: $('" + n_cand + "').item.json.cuenta }) }}"),
            "options": {"response": {"response": {"neverError": True}}},
        }),
    ]
    conexiones[n_cuenta] = {"main": [[{"node": n_carp, "type": "main", "index": 0}]]}
    conexiones[n_carp] = {"main": [[{"node": n_gpx, "type": "main", "index": 0}]]}
    conexiones[n_gpx] = {"main": [[{"node": n_cand, "type": "main", "index": 0}]]}
    conexiones[n_cand] = {"main": [[{"node": n_perm, "type": "main", "index": 0}]]}
    conexiones[n_perm] = {"main": [[{"node": n_reg, "type": "main", "index": 0}]]}
    salidas.append({"node": n_cuenta, "type": "main", "index": 0})
    y += 140

conexiones["Las conocidas"] = {"main": [salidas]}

cuerpo = {"name": NOMBRE, "nodes": nodos, "connections": conexiones, "settings": {"executionOrder": "v1"}}


def n8n(clave, metodo, ruta, datos=None):
    cmd = ["curl", "-s", "-m", "60", "-X", metodo, "-H", f"X-N8N-API-KEY: {clave}", "-H", "content-type: application/json"]
    if datos is not None:
        cmd += ["-d", json.dumps(datos)]
    r = subprocess.run(cmd + [f"{N8N}{ruta}"], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"_crudo": r.stdout[:300]}


if __name__ == "__main__":
    if not CLAVE:
        sys.exit("falta RUTAS_SERVICE_KEY en el entorno")
    clave = sys.argv[1]
    existente = WORKFLOW
    if not existente:
        for w in n8n(clave, "GET", "/workflows?limit=250").get("data", []):
            if w.get("name") == NOMBRE:
                existente = w["id"]
    if existente:
        w = n8n(clave, "PUT", f"/workflows/{existente}", cuerpo)
        print("actualizado:", w.get("name"), "| id:", w.get("id"), "| nodos:", len(w.get("nodes", [])))
    else:
        w = n8n(clave, "POST", "/workflows", cuerpo)
        print("creado:", w.get("name"), "| id:", w.get("id"), "| nodos:", len(w.get("nodes", [])), w.get("_crudo", ""))
    wid = w.get("id")
    if wid:
        a = n8n(clave, "POST", f"/workflows/{wid}/activate")
        print("activo:", a.get("active"), a.get("_crudo", ""))
