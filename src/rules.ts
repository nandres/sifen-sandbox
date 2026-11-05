// Catálogo de las reglas simuladas. Cada una cita de dónde sale: nada de reglas inventadas.
// MT = Manual Técnico SIFEN v150 (septiembre de 2019). Las Notas Técnicas posteriores
// pueden haber cambiado alguna; ver "Fidelidad" en el README.

export type RuleEffect = "A" | "AO" | "R";

export interface Rule {
  code: string;
  message: string;
  effect: RuleEffect;
  source: string;
}

const rule = (code: string, message: string, effect: RuleEffect, source: string): Rule => ({
  code,
  message,
  effect,
  source,
});

const list: Rule[] = [
  // Forma del área de datos
  rule("0100", "Fallo de schema XML del área de datos", "R", "MT §12.2.3 AB01"),
  rule("0101", "Fallo de schema: no existe el campo raíz esperado para el mensaje", "R", "MT §12.2.3 AB02"),
  rule("0104", "Existe algún namespace diferente del namespace estándar del DE", "R", "MT §12.2.3 AB05"),
  rule("0105", "Existe(n) carácter(es) de edición en el inicio o en el final del mensaje, o entre los campos XML", "R", "MT §12.2.3 AB06"),
  rule("0106", "Utilizado prefijo en el namespace", "R", "MT §12.2.3 AB07"),
  rule("0107", "Utilizada codificación diferente de UTF-8", "R", "MT §12.2.3 AB08"),
  // Firma
  rule("0140", "Firma difiere del estándar", "R", "MT §12.2.5 AD01"),
  rule("0141", "Valor de la firma (SignatureValue) diferente del calculado por el PKI", "R", "MT §12.2.5 AD02"),
  rule("0142", "RUC del certificado utilizado para firmar no pertenece al Contribuyente emisor", "R", "MT §12.2.5 AD03"),
  // Mensajes de entrada
  rule("0160", "XML malformado", "R", "MT §12.2.6 AE01"),
  rule("0161", "Servidor de procesamiento momentáneamente sin respuesta", "R", "MT §12.2.6 AE02"),
  rule("0162", "Servidor de procesamiento paralizado, sin tiempo de regreso", "R", "MT §12.2.6 AE03"),
  rule("0163", "Versión del formato del WS no soportada", "R", "MT §12.2.6 AE04"),
  // Tamaños
  rule("0200", "Mensaje de datos de entrada del WS siRecepDE superior a 1000 KB", "R", "MT §12.3.1.1 BA01"),
  rule("0270", "Mensaje de datos de entrada del WS siRecepLoteDE superior a 10.000 KB", "R", "MT §12.3.2.1 BD01"),
  rule("0320", "Mensaje de datos de entrada del WS siResultLoteDE superior a 1000 KB", "R", "MT §12.3.3.1 BG01"),
  rule("0380", "Mensaje de datos de entrada del WS siConsDE superior a 1000 KB", "R", "MT §12.3.4.1 BJ01"),
  rule("0460", "Mensaje de datos de entrada del WS siConsRUC superior a 1000 KB", "R", "MT §12.3.5.1 BM01"),
  rule("0560", "Mensaje de datos de entrada del WS siRecepEvento superior a 1000 KB", "R", "MT §12.3.6.1 BS01"),
  // Resultados de los servicios
  rule("0260", "Autorización del DE satisfactoria", "A", "MT §12.3.1.3 BC01"),
  rule("0300", "Lote recibido con éxito", "A", "MT §12.3.2.3 BF01"),
  rule("0301", "Lote no encolado para procesamiento", "R", "MT §12.3.2.3 BF02"),
  rule("0360", "Lote inexistente", "R", "MT §12.3.3.3 BI01, Tabla F"),
  rule("0361", "Lote en procesamiento", "R", "MT §12.3.3.3 BI02, Tabla F"),
  rule("0362", "Procesamiento de lote concluido", "A", "MT §12.3.3.3 BI03, Tabla F"),
  rule("0363", "Lotes con tipos distintos de DE", "R", "MT §12.3.3.3 B104"),
  rule("0420", "CDC inexistente", "R", "MT §9.4 Tabla G"),
  // El manual se contradice: §12.3.4.3 da 0421 como "CDC encontrado"; §9.4 Tabla G y el
  // cuadro del protocolo de respuesta dan 0422. Se sigue §9.4.
  rule("0422", "CDC encontrado", "A", "MT §9.4 Tabla G"),
  rule("0500", "RUC inexistente", "R", "MT §12.3.5.3 BO01"),
  rule("0501", "RUC no tiene permiso para utilizar el WS", "R", "MT §12.3.5.3 BO02"),
  rule("0502", "RUC encontrado", "A", "MT §9.6 Tabla H"),
  rule("0600", "Evento registrado correctamente", "A", "MT §12.3.6.3 BU01"),
  // Formato del DE
  rule("1000", "CDC no correspondiente con las informaciones del XML", "R", "MT §12.4 A002"),
  rule("1001", "CDC duplicado", "R", "MT §12.4 A002a"),
  rule("1002", "Documento electrónico duplicado", "R", "MT §12.4 A002b"),
  rule("1003", "DV del CDC inválido", "R", "MT §12.4 A003"),
  rule("1004", "La fecha y hora de la firma digital es adelantada", "R", "MT §12.4 A004a"),
  rule("1005", "Transmisión extemporánea del DE", "AO", "MT §12.4 A004b, §6.2.1 (72 horas)"),
  rule("1050", "Tipo de emisión inválido en esta etapa", "R", "MT §12.4 B002"),
  rule("1051", "Descripción del tipo de emisión no corresponde al código", "R", "MT §12.4 B003"),
  rule("1100", "Descripción del tipo de documento electrónico no corresponde al código", "R", "MT §12.4 C003"),
  rule("1101", "Número de timbrado inválido", "R", "MT §12.4 C004"),
  rule("1103", "El número de timbrado no se encuentra vigente a la fecha de emisión del comprobante", "R", "MT §12.4 C004b"),
  rule("1104", "El número de timbrado informado no se encuentra en estado ACTIVO", "R", "MT §12.4 C004c"),
  rule("1150", "La fecha y hora de emisión del DE informada es inválida por retraso", "R", "MT §12.4 D002 (720 horas)"),
  rule("1151", "La fecha y hora de emisión del DE informada es inválida por envío adelantado", "R", "MT §12.4 D002f (120 horas)"),
  rule("1156", "Fecha y hora de emisión del DE es anterior a la fecha de lanzamiento del sistema", "R", "MT §12.4 D002a"),
  rule("1250", "RUC del emisor inexistente", "R", "MT §12.4 D101"),
  rule("1251", "RUC del Emisor inhabilitado para facturación electrónica", "R", "MT §12.4 D101a"),
  rule("1252", "El RUC del emisor se encuentra inactivo", "R", "MT §12.4 D101b"),
  rule("1253", "Dígito Verificador del RUC del emisor incorrecto", "R", "MT §12.4 D102"),
  rule("1264", "RUC del emisor no está habilitado para utilizar este tipo de servicio", "R", "MT §12.4 D101c"),
  rule("2500", "QR no es coincidente con el archivo XML", "R", "MT §12.4 J002"),
  rule("2501", "El hash del código QR incluido en la cadena de caracteres no corresponde al calculado", "R", "MT §12.4 J002a, §13.8.3"),
  rule("2502", "URL de consulta de código QR es inválida", "R", "MT §12.4 J002b, §13.8.2"),
  // Evento de cancelación
  rule("4000", "La versión no corresponde", "R", "MT §11.6.1 GDE005"),
  rule("4001", "CDC inválido", "R", "MT §11.6.1 GEC002"),
  rule("4002", "CDC no existente en el SIFEN", "R", "MT §11.6.1 GEC002a"),
  rule("4003", "CDC ya se encuentra con el mismo evento solicitado", "R", "MT §11.6.1 GEC002b"),
  rule("4008", "Fecha de firma digital del evento inválida", "R", "MT §11.6.1 GDE004"),
  rule("4009", "Plazo de solicitud de cancelación de una FE extemporáneo", "R", "MT §11.6.1 GDE004a (48 horas)"),
  rule("4010", "Plazo de solicitud de cancelación distinto a una FE es extemporáneo", "R", "MT §11.6.1 GDE004b (168 horas)"),
];

export const RULES: Readonly<Record<string, Rule>> = Object.fromEntries(list.map((r) => [r.code, r]));

export interface RuleHit {
  code: string;
  message: string;
  effect: RuleEffect;
  source: string;
  detail?: string;
}

export function hit(code: string, detail?: string): RuleHit {
  const found = RULES[code];
  if (!found) throw new Error(`Regla desconocida: ${code}`);
  return { ...found, ...(detail ? { detail } : {}) };
}
