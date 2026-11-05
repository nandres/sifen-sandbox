import { createHash } from "node:crypto";

import { hit, type RuleHit } from "./rules.js";

export const QR_BASE_TEST = "https://ekuatia.set.gov.py/consultas-test/qr?";
export const QR_BASE_PROD = "https://ekuatia.set.gov.py/consultas/qr?";

export interface QrExpected {
  cdc: string;
  fechaEmision: string;
  receptor: string;
  totalGeneral: string;
  totalIva: string;
  items: number;
  digest: string;
}

const hex = (value: string): string => Buffer.from(value, "utf8").toString("hex");

/** Arma la cadena del QR, sin el hash. MT §13.8.2 y §13.8.3. */
export function qrParameters(expected: QrExpected, cscId: string): string {
  return [
    "nVersion=150",
    `Id=${expected.cdc}`,
    `dFeEmiDE=${hex(expected.fechaEmision)}`,
    expected.receptor,
    `dTotGralOpe=${expected.totalGeneral}`,
    `dTotIVA=${expected.totalIva}`,
    `cItems=${expected.items}`,
    `DigestValue=${hex(expected.digest)}`,
    `IdCSC=${cscId}`,
  ].join("&");
}

export function qrHash(parameters: string, csc: string): string {
  return createHash("sha256").update(parameters + csc).digest("hex");
}

export function checkQr(url: string | undefined, expected: QrExpected, cscs: ReadonlyMap<string, string>): RuleHit | undefined {
  if (!url) return hit("2500", "Falta dCarQR");
  // El manual da la dirección sin www en §13.8.2 y con www en §13.8.4.4: se aceptan las dos.
  const normalized = url.replace("https://www.ekuatia.", "https://ekuatia.");
  if (normalized.startsWith(QR_BASE_PROD)) {
    return hit("2502", "El QR apunta a la consulta de producción; en pruebas va a consultas-test");
  }
  if (!normalized.startsWith(QR_BASE_TEST)) return hit("2502", `La URL debe empezar con ${QR_BASE_TEST}`);

  const query = normalized.slice(QR_BASE_TEST.length);
  const marker = "&cHashQR=";
  const position = query.lastIndexOf(marker);
  if (position < 0) return hit("2501", "Falta cHashQR");
  const parameters = query.slice(0, position);
  const received = query.slice(position + marker.length);

  const cscId = /(?:^|&)IdCSC=([^&]*)/.exec(parameters)?.[1] ?? "";
  const csc = cscs.get(cscId) ?? cscs.get(cscId.replace(/^0+/, ""));
  if (csc === undefined) return hit("2501", `IdCSC "${cscId}" no está cargado en el simulador`);

  const wanted = qrParameters(expected, cscId);
  if (parameters !== wanted) return hit("2500", `Se esperaba: ${wanted}`.slice(0, 500));
  if (received !== qrHash(parameters, csc)) {
    return hit("2501", "cHashQR debe ser el SHA-256 en hexadecimal minúscula de los parámetros más el CSC");
  }
  return undefined;
}
