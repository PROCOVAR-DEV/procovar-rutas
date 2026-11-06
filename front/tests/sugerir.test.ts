import { test } from "node:test";
import assert from "node:assert/strict";
import { sugerirPersona } from "../lib/sugerir";

const gente = [
  { authUserId: "1", name: "Niurbelis Sánchez", email: "niurbelis.sanchez@procovar.cloud" },
  { authUserId: "2", name: "Yoan Domínguez Hidalgo", email: "yoan.dominguez@procovar.cloud" },
  { authUserId: "3", name: "Yaima Zaldívar", email: "yaima.zaldivar@procovar.cloud" },
  { authUserId: "4", name: "Yaima Pérez", email: "yaima.perez@procovar.cloud" },
];

test("el nombre de la carpeta cuadra con una sola persona", () => {
  assert.equal(sugerirPersona("Niurbelis Sánchez", gente)?.authUserId, "1");
  assert.equal(sugerirPersona("GPS yoan Domínguez", gente)?.authUserId, "2");
  assert.equal(sugerirPersona("GPS Yoan", gente)?.authUserId, "2");
});

test("si cuadra con dos, no se sugiere nada", () => {
  assert.equal(sugerirPersona("Yaima", gente), null);
});

test("sin nombre propio (solo ruido) o sin coincidencia, nada", () => {
  assert.equal(sugerirPersona("TABLET3", gente), null);
  assert.equal(sugerirPersona("GPS Supervisora BAY", gente), null);
  assert.equal(sugerirPersona("Luis Verdecia", gente), null);
});

test("las tildes y las mayúsculas no importan", () => {
  assert.equal(sugerirPersona("NIURBELIS SANCHEZ", gente)?.authUserId, "1");
});
