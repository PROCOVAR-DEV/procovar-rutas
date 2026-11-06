import { test } from "node:test";
import assert from "node:assert/strict";
import { sugerirGps, sugerirPersona, vendedoresDe } from "../lib/sugerir";

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

test("de un vendedor de PEDIDO al GPS que lleva su nombre", () => {
  const gps = [{ name: "GEORLI" }, { name: "ALEXANDER" }, { name: "TABLET3" }, { name: "GPS Oreste" }, { name: "GPS Oreste" }];

  assert.equal(sugerirGps({ name: "GEORLIS MICHEL CARDENAS MORA", code: "georlis.cardenas" }, gps)?.name, "GEORLI");
  // Dos GPS con el mismo nombre: no se adivina.
  assert.equal(sugerirGps({ name: "ORESTE VALDEZ ROSABAL", code: "oreste.valdez" }, gps), null);
  assert.equal(sugerirGps({ name: "VENTA ALMACEN", code: "venta.almacen" }, gps), null);
});

test("de una persona de Accesos a su vendedor de PEDIDO", () => {
  const vendedores = [
    { name: "GEORLIS MICHEL CARDENAS MORA", code: "georlis.cardenas" },
    { name: "IRADIEL CISNEROS", code: "iradiel.cisneros" },
  ];
  const persona = { name: "georlis.cardenas", email: "georlis.cardenas@procovar.cloud" };

  assert.deepEqual(vendedoresDe(persona, vendedores).map((v) => v.code), ["georlis.cardenas"]);
  assert.equal(vendedoresDe({ name: "Otra Persona", email: "otra@x" }, vendedores).length, 0);
});
