import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SchemaSet } from "../src/xsd.js";
import {
  NOW_ISO,
  PATHS,
  XSD_DIR,
  buildCancelEvent,
  buildDocument,
  consultaLoteRequest,
  consultaRequest,
  consultaRucRequest,
  createIdentity,
  envelope,
  eventoRequest,
  field,
  fields,
  loteRequest,
  recibeRequest,
  start,
  type Identity,
  type Running,
} from "./helpers.js";

let sandbox: Running;
let identity: Identity;
const schemas = new SchemaSet(XSD_DIR);

beforeAll(async () => {
  identity = createIdentity();
  sandbox = await start();
});
afterAll(() => sandbox.close());
beforeEach(() => {
  sandbox.sandbox.store.reset();
  sandbox.sandbox.store.setClock(NOW_ISO);
});

const inner = (body: string, root: string): string => new RegExp(`<${root}[\\s\\S]*</${root}>`).exec(body)?.[0] ?? "";
const approve = async (numero = "0000001"): Promise<string> => {
  const { xml, cdc } = buildDocument(identity, { numero });
  const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
  expect(field(response.body, "dCodRes")).toBe("0260");
  return cdc;
};

describe("siRecepLoteDE y siResultLoteDE", () => {
  const send = async (documents: string[]) => {
    const response = await sandbox.post(PATHS.lote, loteRequest(documents));
    return { body: response.body, lot: field(response.body, "dProtConsLote") ?? "", code: field(response.body, "dCodRes") };
  };

  it("recibe con 0300 y la respuesta cumple el esquema", async () => {
    const { body, code, lot } = await send([buildDocument(identity).xml]);
    expect(code).toBe("0300");
    expect(lot).toBe("1");
    expect((await schemas.validate("WS_SiRecepLoteDE_v141.xsd", inner(body, "rResEnviLoteDe"))).errors).toEqual([]);
  });

  it("0361 mientras procesa y 0362 al terminar, con aprobados y rechazados", async () => {
    const slow = await start(60_000);
    try {
      const good = buildDocument(identity, { numero: "0000001" });
      const bad = buildDocument(identity, { numero: "0000002", afterSign: (xml) => xml.replace("SERVICIO DE PRUEBA", "ALTERADO") });
      const lot = field((await slow.post(PATHS.lote, loteRequest([good.xml, bad.xml]))).body, "dProtConsLote") ?? "";

      const pending = await slow.post(PATHS.consultaLote, consultaLoteRequest(lot));
      expect(field(pending.body, "dCodResLot")).toBe("0361");

      await slow.control(`/lots/${lot}/finish`, {});
      const done = await slow.post(PATHS.consultaLote, consultaLoteRequest(lot));
      expect(field(done.body, "dCodResLot")).toBe("0362");
      expect(fields(done.body, "id")).toEqual([good.cdc, bad.cdc]);
      expect(fields(done.body, "dEstRes")).toEqual(["Aprobado", "Rechazado"]);
      expect(fields(done.body, "dCodRes")).toEqual(["0260", "0141"]);
      expect((await schemas.validate("WS_SiConsLote_v141.xsd", inner(done.body, "rResEnviConsLoteDe"))).errors).toEqual([]);

      const again = await slow.post(PATHS.consultaLote, consultaLoteRequest(lot));
      expect(fields(again.body, "dCodRes")).toEqual(["0260", "0141"]);
    } finally {
      await slow.close();
    }
  });

  it("detecta duplicados dentro del mismo lote", async () => {
    const { xml } = buildDocument(identity);
    const { lot } = await send([xml, xml]);
    const done = await sandbox.post(PATHS.consultaLote, consultaLoteRequest(lot));
    expect(fields(done.body, "dCodRes")).toEqual(["0260", "1001"]);
  });

  it("el lote no aplica la restricción 1264 de los servicios síncronos", async () => {
    await sandbox.control("/ruc", { ruc: "80000001", usaServicioSincrono: false });
    const { lot } = await send([buildDocument(identity).xml]);
    const done = await sandbox.post(PATHS.consultaLote, consultaLoteRequest(lot));
    expect(fields(done.body, "dCodRes")).toEqual(["0260"]);
  });

  it("0363 si mezcla tipos de documento", async () => {
    const first = buildDocument(identity).xml;
    const second = buildDocument(identity, { numero: "0000002", tipo: "4", descTipo: "Autofactura electrónica" }).xml;
    const { lot } = await send([first, second]);
    const done = await sandbox.post(PATHS.consultaLote, consultaLoteRequest(lot));
    expect(field(done.body, "dCodResLot")).toBe("0363");
  });

  it("0301 si tiene más de 50 documentos", async () => {
    const { xml } = buildDocument(identity);
    const { code } = await send(Array.from({ length: 51 }, () => xml));
    expect(code).toBe("0301");
  });

  it("0301 si xDE no es un ZIP", async () => {
    const response = await sandbox.post(PATHS.lote, envelope(`<rEnvioLote xmlns="http://ekuatia.set.gov.py/sifen/xsd"><dId>1</dId><xDE>bm8gZXMgemlw</xDE></rEnvioLote>`));
    expect(field(response.body, "dCodRes")).toBe("0301");
  });

  it("0360 si el lote no existe", async () => {
    const response = await sandbox.post(PATHS.consultaLote, consultaLoteRequest("999"));
    expect(field(response.body, "dCodResLot")).toBe("0360");
  });
});

describe("siConsDE", () => {
  it("0422 con el documento, y la respuesta cumple el esquema", async () => {
    const cdc = await approve();
    const response = await sandbox.post(PATHS.consulta, consultaRequest(cdc));
    expect(field(response.body, "dCodRes")).toBe("0422");
    expect(response.body).toContain("&lt;rContDe&gt;");
    expect((await schemas.validate("WS_SiConsDE_v141.xsd", inner(response.body, "rEnviConsDeResponse"))).errors).toEqual([]);
  });

  it("0420 si no existe", async () => {
    const { cdc } = buildDocument(identity);
    const response = await sandbox.post(PATHS.consulta, consultaRequest(cdc));
    expect(field(response.body, "dCodRes")).toBe("0420");
    expect((await schemas.validate("WS_SiConsDE_v141.xsd", inner(response.body, "rEnviConsDeResponse"))).errors).toEqual([]);
  });

  it("0100 si el CDC no tiene la forma correcta", async () => {
    const response = await sandbox.post(PATHS.consulta, consultaRequest("123"));
    expect(field(response.body, "dCodRes")).toBe("0100");
  });
});

describe("siConsRUC", () => {
  it("0502 con los datos, y la respuesta cumple el esquema", async () => {
    const response = await sandbox.post(PATHS.consultaRuc, consultaRucRequest("80000001"));
    expect(field(response.body, "dCodRes")).toBe("0502");
    expect(field(response.body, "dCodEstCons")).toBe("ACT");
    expect((await schemas.validate("WS_SiConsRUC_v141.xsd", inner(response.body, "rResEnviConsRUC"))).errors).toEqual([]);
  });

  it("0500 y 0501 según el contribuyente cargado", async () => {
    await sandbox.control("/ruc", { ruc: "80000003", existe: false });
    await sandbox.control("/ruc", { ruc: "80000004", puedeConsultar: false });
    expect(field((await sandbox.post(PATHS.consultaRuc, consultaRucRequest("80000003"))).body, "dCodRes")).toBe("0500");
    expect(field((await sandbox.post(PATHS.consultaRuc, consultaRucRequest("80000004"))).body, "dCodRes")).toBe("0501");
  });

  it("devuelve la razón social cargada", async () => {
    await sandbox.control("/ruc", { ruc: "80000005", razonSocial: "EMPRESA <PRUEBA> & CIA", estado: "CAN" });
    const response = await sandbox.post(PATHS.consultaRuc, consultaRucRequest("80000005"));
    expect(response.body).toContain("EMPRESA &lt;PRUEBA&gt; &amp; CIA");
    expect(field(response.body, "dDesEstCons")).toBe("CANCELADO");
  });
});

describe("siRecepEvento: cancelación", () => {
  const cancel = async (cdc: string, signedAt?: string) => {
    const response = await sandbox.post(PATHS.evento, eventoRequest(buildCancelEvent(identity, cdc, signedAt)));
    return { body: response.body, code: field(response.body, "dCodRes"), status: field(response.body, "dEstRes") };
  };

  it("0600 y la respuesta cumple el esquema", async () => {
    const cdc = await approve();
    const { code, status, body } = await cancel(cdc);
    expect(code).toBe("0600");
    expect(status).toBe("Aprobado");
    expect(field(body, "id")).toBe("1");
    expect((await schemas.validate("WS_SiRecepEvento_v150.xsd", inner(body, "rRetEnviEventoDe"))).errors).toEqual([]);
  });

  it("4002 si el documento no está aprobado", async () => {
    expect((await cancel(buildDocument(identity).cdc)).code).toBe("4002");
  });

  it("4003 si ya estaba cancelado", async () => {
    const cdc = await approve();
    await cancel(cdc);
    expect((await cancel(cdc)).code).toBe("4003");
  });

  it("4008 si la firma es del futuro", async () => {
    const cdc = await approve();
    expect((await cancel(cdc, "2026-11-05T10:00:01")).code).toBe("4008");
  });

  it("4009 si pasaron más de 48 horas desde la aprobación", async () => {
    const cdc = await approve();
    sandbox.sandbox.store.setClock("2026-11-08T10:00:00-03:00");
    expect((await cancel(cdc, "2026-11-07T10:00:01")).code).toBe("4009");
  });

  it("acepta exactamente a las 48 horas", async () => {
    const cdc = await approve();
    sandbox.sandbox.store.setClock("2026-11-08T10:00:00-03:00");
    expect((await cancel(cdc, "2026-11-07T10:00:00")).code).toBe("0600");
  });
});

describe("fallas a pedido", () => {
  const sendOk = async () => {
    const { xml } = buildDocument(identity);
    return sandbox.post(PATHS.recibe, recibeRequest(xml));
  };

  it("http: responde el estado pedido y después vuelve a la normalidad", async () => {
    await sandbox.control("/faults", { service: "siRecepDE", kind: "http", status: 503, times: 2 });
    expect((await sendOk()).status).toBe(503);
    expect((await sendOk()).status).toBe(503);
    expect(field((await sendOk()).body, "dCodRes")).toBe("0260");
  });

  it("code: devuelve el código del manual", async () => {
    await sandbox.control("/faults", { service: "siRecepDE", kind: "code", code: "0161" });
    expect(field((await sendOk()).body, "dCodRes")).toBe("0161");
  });

  it("soapFault: responde 500 con un Fault", async () => {
    await sandbox.control("/faults", { service: "*", kind: "soapFault" });
    const response = await sendOk();
    expect(response.status).toBe(500);
    expect(response.body).toContain("Fault");
  });

  it("drop: corta la conexión", async () => {
    await sandbox.control("/faults", { service: "siRecepDE", kind: "drop" });
    await expect(sendOk()).rejects.toThrow();
    expect(field((await sendOk()).body, "dCodRes")).toBe("0260");
  });

  it("delay: demora y procesa igual", async () => {
    await sandbox.control("/faults", { service: "siRecepDE", kind: "delay", ms: 150 });
    const started = Date.now();
    expect(field((await sendOk()).body, "dCodRes")).toBe("0260");
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it("una falla de otro servicio no afecta", async () => {
    await sandbox.control("/faults", { service: "siConsRUC", kind: "http" });
    expect(field((await sendOk()).body, "dCodRes")).toBe("0260");
  });
});

describe("API de control", () => {
  it("rechaza fallas mal pedidas", async () => {
    expect((await sandbox.control("/faults", { kind: "explotar" })).status).toBe(400);
    expect((await sandbox.control("/faults", { kind: "http", service: "otro" })).status).toBe(400);
    expect((await sandbox.control("/faults", { kind: "code", code: "9999" })).status).toBe(400);
  });

  it("guarda el historial con la fuente de cada regla", async () => {
    const { xml } = buildDocument(identity, { afterSign: (x) => x.replace("SERVICIO DE PRUEBA", "ALTERADO") });
    await sandbox.post(PATHS.recibe, recibeRequest(xml));
    const { json } = await sandbox.control("/requests");
    expect(json[0].service).toBe("siRecepDE");
    expect(json[0].results[0].code).toBe("0141");
    expect(json[0].results[0].source).toContain("MT §12.2.5");
  });

  it("reset borra los documentos", async () => {
    await approve();
    expect((await sandbox.control("/documents")).json).toHaveLength(1);
    await sandbox.control("/reset", {});
    expect((await sandbox.control("/documents")).json).toHaveLength(0);
  });

  it("todas las reglas citan su fuente", async () => {
    const { json } = await sandbox.control("/rules");
    expect(json.length).toBeGreaterThan(40);
    for (const rule of json) expect(rule.source).toMatch(/^MT /);
  });

  it("una ruta desconocida lista los servicios", async () => {
    const response = await fetch(`${sandbox.base}/otra`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { services: string[] }).services).toContain(PATHS.recibe);
  });
});
