import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { validateXML } from "xmllint-wasm";

export interface SchemaResult {
  valid: boolean;
  errors: string[];
}

interface SchemaFile {
  fileName: string;
  contents: string;
}

export const SCHEMA_DE = "siRecepDE_v150.xsd";
export const SCHEMA_WS: Readonly<Record<string, string>> = {
  rEnviDe: "WS_SiRecepDE_v150.xsd",
  rEnvioLote: "WS_SiRecepLoteDE_v141.xsd",
  rEnviConsLoteDe: "WS_SiConsLote_v141.xsd",
  rEnviConsDeRequest: "WS_SiConsDE_v141.xsd",
  rEnviConsRUC: "WS_SiConsRUC_v141.xsd",
  rEnviEventoDe: "WS_SiRecepEvento_v150.xsd",
};

export class SchemaSet {
  private readonly files: SchemaFile[];

  constructor(directory: string) {
    if (!existsSync(directory) || !existsSync(join(directory, SCHEMA_DE))) {
      throw new Error(`Faltan los XSD oficiales en ${directory}. Corré: npm run xsd:download`);
    }
    this.files = readdirSync(directory)
      .filter((name) => name.endsWith(".xsd"))
      .map((fileName) => ({ fileName, contents: readFileSync(join(directory, fileName), "utf8") }));
  }

  async validate(schemaName: string, xml: string): Promise<SchemaResult> {
    const main = this.files.find((file) => file.fileName === schemaName);
    if (!main) throw new Error(`Esquema desconocido: ${schemaName}`);
    const result = await validateXML({
      xml: [{ fileName: "documento.xml", contents: xml }],
      schema: [main],
      preload: this.files.filter((file) => file !== main),
    });
    return { valid: result.valid, errors: result.errors.map((error) => error.message) };
  }
}
