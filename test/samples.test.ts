import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SCENARIOS } from "../src/sample.js";
import { NOW_ISO, field, start, type Running } from "./helpers.js";

let sandbox: Running;

beforeAll(async () => {
  sandbox = await start();
});
afterAll(() => sandbox.close());

describe("ejemplos listos para enviar", () => {
  it("los lista con el código esperado", async () => {
    const { json } = await sandbox.control("/samples");
    expect(json.map((sample: { name: string }) => sample.name)).toContain("factura-valida");
    expect(json[0].expected).toBe("0260");
    expect(json[0].options).toBeUndefined();
  });

  it.each(SCENARIOS.map((scenario) => [scenario.name, scenario] as const))("%s da el código esperado", async (name, scenario) => {
    const request = await (await fetch(`${sandbox.base}/__sandbox/samples/${name}`)).text();
    const response = await sandbox.post(scenario.path, request);
    expect(field(response.body, "dCodRes")).toBe(scenario.expected);
  });

  it("no se duplica aunque se pida varias veces", async () => {
    for (let i = 0; i < 3; i += 1) {
      const request = await (await fetch(`${sandbox.base}/__sandbox/samples/factura-valida`)).text();
      const response = await sandbox.post("/de/ws/sync/recibe.wsdl", request);
      expect(field(response.body, "dCodRes")).toBe("0260");
    }
  });

  it("usa la leyenda del ambiente de pruebas, así el historial no avisa nada", async () => {
    sandbox.sandbox.store.reset();
    sandbox.sandbox.store.setClock(NOW_ISO);
    const request = await (await fetch(`${sandbox.base}/__sandbox/samples/factura-valida`)).text();
    await sandbox.post("/de/ws/sync/recibe.wsdl", request);
    const { json } = await sandbox.control("/requests");
    expect(json[0].notes).toBeUndefined();
  });

  it("avisa si el ejemplo no existe", async () => {
    const response = await fetch(`${sandbox.base}/__sandbox/samples/otro`);
    expect(response.status).toBe(404);
  });
});
