import type { RuleHit } from "./rules.js";

export type RucState = "ACT" | "CAN" | "CDE" | "SUS" | "BLQ";

export interface RucEntry {
  ruc: string;
  razonSocial: string;
  estado: RucState;
  facturaElectronica: boolean;
  usaServicioSincrono: boolean;
  puedeConsultar: boolean;
  existe: boolean;
}

export interface TimbradoEntry {
  ruc: string;
  numero: string;
  activo: boolean;
}

export interface StoredDocument {
  cdc: string;
  xml: string;
  digest: string;
  protAut: string;
  status: string;
  ruc: string;
  tipo: string;
  approvedAt: number;
  cancelled: boolean;
}

export interface LotItem {
  id: string;
  status: string;
  protAut?: string;
  results: RuleHit[];
}

export interface StoredLot {
  id: string;
  documents: string[];
  receivedAt: number;
  readyAt: number;
  results?: LotItem[];
  code?: string;
}

export type FaultKind = "http" | "delay" | "drop" | "soapFault" | "code";

export interface Fault {
  id: number;
  service: string;
  kind: FaultKind;
  /** Cuántos pedidos afecta; -1 es hasta que se borre. */
  times: number;
  status?: number;
  ms?: number;
  code?: string;
}

export interface RequestLogEntry {
  at: string;
  service: string;
  dId?: string;
  cdc?: string;
  status?: string;
  results: RuleHit[];
  fault?: FaultKind;
}

const MAX_LOG = 500;

/** Todo el estado vive en memoria y se pierde al reiniciar: es lo esperable en un simulador. */
export class Store {
  documents = new Map<string, StoredDocument>();
  timbradoKeys = new Map<string, string>();
  lots = new Map<string, StoredLot>();
  rucs = new Map<string, RucEntry>();
  timbrados = new Map<string, TimbradoEntry>();
  faults: Fault[] = [];
  log: RequestLogEntry[] = [];
  private fixedNow: number | undefined;
  private protAutSequence = 0;
  private lotSequence = 0;
  private faultSequence = 0;

  reset(): void {
    this.documents.clear();
    this.timbradoKeys.clear();
    this.lots.clear();
    this.rucs.clear();
    this.timbrados.clear();
    this.faults = [];
    this.log = [];
    this.fixedNow = undefined;
    this.protAutSequence = 0;
    this.lotSequence = 0;
  }

  now(): number {
    return this.fixedNow ?? Date.now();
  }

  setClock(iso: string | null): void {
    if (iso === null) {
      this.fixedNow = undefined;
      return;
    }
    const value = Date.parse(iso);
    if (Number.isNaN(value)) throw new Error("Fecha inválida");
    this.fixedNow = value;
  }

  isClockFixed(): boolean {
    return this.fixedNow !== undefined;
  }

  nextProtAut(): string {
    this.protAutSequence += 1;
    return String(this.protAutSequence).padStart(10, "0");
  }

  nextLotId(): string {
    this.lotSequence += 1;
    return String(this.lotSequence);
  }

  ruc(ruc: string): RucEntry {
    return (
      this.rucs.get(ruc) ?? {
        ruc,
        razonSocial: "CONTRIBUYENTE DE PRUEBA",
        estado: "ACT",
        facturaElectronica: true,
        usaServicioSincrono: true,
        puedeConsultar: true,
        existe: true,
      }
    );
  }

  addFault(fault: Omit<Fault, "id">): Fault {
    this.faultSequence += 1;
    const stored = { ...fault, id: this.faultSequence };
    this.faults.push(stored);
    return stored;
  }

  /** Consume la próxima falla programada para ese servicio. */
  takeFault(service: string): Fault | undefined {
    const fault = this.faults.find((f) => (f.service === service || f.service === "*") && f.times !== 0);
    if (!fault) return undefined;
    if (fault.times > 0) fault.times -= 1;
    if (fault.times === 0) this.faults = this.faults.filter((f) => f !== fault);
    return fault;
  }

  record(entry: RequestLogEntry): void {
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.shift();
  }
}
