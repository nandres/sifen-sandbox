# Notas Técnicas y guías de la DNIT

Qué documentos oficiales se revisaron y cómo afectan al simulador. Revisión del 5 de noviembre de 2026, sobre el [portal de la DNIT](https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica), que publicaba las notas de la 001 a la 027.

La DNIT puede reemplazar un archivo sin cambiarle el nombre, así que se anota el inicio del SHA-256 de cada PDF revisado.

## Documentos de base

| Documento | Fecha | SHA-256 |
|---|---|---|
| Manual Técnico v150 | Septiembre de 2019 | `976cd88c05c3` |
| Recomendaciones y mejores prácticas para SIFEN (la «Guía») | Octubre de 2024 | `6aa46da4affd` |
| Guía de Pruebas para e-Kuatia | Sin revisar en detalle salvo el §2 | `34a6823f2869` |

## Notas Técnicas

La fecha es la de puesta en producción cuando la nota la declara; en las anteriores a la 13, la fecha de la nota. Las notas son correcciones parciales: se revisaron buscando lo que toca a las reglas simuladas, no se transcribieron enteras.

| NT | Fecha | Qué cambia | Estado | Detalle | SHA-256 |
|---|---|---|---|---|---|
| 1 | 14/10/2019 | Aclara `1103` y fórmulas de descuentos y totales | Parcial | `1103` aplicada. Los cálculos no se simulan. | `4c47b667084d` |
| 2 | 16/07/2020 | Campos; elimina `1323` | No afecta | Formato en el XSD. `1323` nunca se simuló. | `6aaf4a8f4797` |
| 3 | 18/11/2020 | Campos; elimina `1324` y `1327` | No afecta | Formato en el XSD. Esas reglas nunca se simularon. | `3d27fa591b59` |
| 4 | 29/12/2020 | Elimina `1251` | Aplicada | El simulador ya no rechaza por no figurar como facturador. | `185619ec4bad` |
| 5 | 09/02/2021 | Campos | No afecta | Formato en el XSD. | `6889f1fc4f2e` |
| 6 | 25/03/2021 | Agrega `1216` | Aplicada |  | `44db68fbdcc1` |
| 7 | 01/02/2022 | Campos del grupo B | No afecta | Formato en el XSD. | `ad25333d61ec` |
| 8 | 21/09/2021 | Campos de póliza y totales | No afecta | Formato en el XSD. | `2b1c2f0b25e9` |
| 9 | 09/09/2021 | Campos de ítems | No afecta | Formato en el XSD. | `bc6a85c1e77e` |
| 10 | 04/02/2022 | URL del QR, CSC vencido, receptor, documentos asociados | Parcial | URL sin `www`, `2501` por CSC y `1300` aplicadas. Documentos asociados no simulados. | `d261165c512c` |
| 11 | 20/10/2022 | Servicio de consulta masiva de RUC | No simulada | El servicio no existe en el simulador. | `6abf95164f4e` |
| 12 | 21/02/2023 | Agrega `1213` | Aplicada |  | `3f9243e48a0a` |
| 13 | 17/06/2023 | Cálculos de IVA y base exenta | No simulada | El simulador no recalcula montos. | `5e9e85ec22f1` |
| 14 | 08/08/2023 | Evento de nominación | No simulada | Solo se simula la cancelación. | `5320a52a9152` |
| 15 | 21/09/2023 | Agrega `2442` | No simulada | Depende del evento de nominación. | `d41ae8e7d1fd` |
| 16 | 22/09/2023 | Firma, certificados y TLS | Parcial | `0120`, `0140`, `0141` y `2450` aplicadas. Sin cadena de confianza, LCR ni revocación. | `6406e5e6cd4f` |
| 17 | 25/08/2023 | Mensajes de `1326` y `1329` | No simulada | No se validan catálogos de geografía. | `21112d7c0a1a` |
| 18 | 08/01/2024 | Obligaciones afectadas (RG90) y evento de transporte | No simulada |  | `96079a30c8c1` |
| 19 | 31/01/2024 | Eventos del receptor | No simulada | Solo se simula la cancelación. | `c3fcd3bd96d0` |
| 20 | 31/01/2024 | Operaciones con el Estado; agrega `1332` | No simulada | Requiere la base real de organismos del Estado. | `0d877d1fb16a` |
| 21 | 01/01/2024 | `1321`: innominado hasta 35 millones | Aplicada | Según la fecha de proceso. | `1e716577d874` |
| 22 | 09/02/2024 | Agrega `1222` | No simulada |  | `269840094089` |
| 23 | 27/09/2024 | Receptor y documentos asociados | Parcial | `1314`, `1331`, `1333`, `1334` y `1335` aplicadas. Documentos asociados no simulados. | `9cb063673358` |
| 24 | 01/01/2025 | `1321`: innominado hasta 7 millones | Aplicada | Según la fecha de proceso. | `ccc2d1550e92` |
| 25 | 28/04/2025 | Excluye `4004` | No afecta | `4004` nunca se simuló. | `3950e171f161` |
| 26 | 16/06/2025 | Compras públicas; excluye `1400`, `1401`, `1800` y `1801` | No afecta | Esas reglas nunca se simularon. | `5ed252f14427` |
| 27 | 09/03/2026 | Campos del evento de nominación | No simulada | Solo se simula la cancelación. | `3ff6fbbf9f54` |

**Estados:** *Aplicada* está en el simulador. *Parcial* está en lo que el simulador cubre. *No afecta* no cambia nada de lo que simula. *No simulada* cambia algo que el simulador no implementa.

«Formato en el XSD» quiere decir que el cambio es de campos y que se confía en que los XSD publicados ya lo incluyen. No se comprobó campo por campo.

## Lo que aporta la Guía de octubre de 2024

Tiene las únicas respuestas reales de SIFEN en la documentación oficial, así que cuando contradice al manual se sigue la Guía.

| Tema | Manual | Guía | Simulador |
|---|---|---|---|
| Valor inválido en el DE | `0100` | `0160`, con «XML malformado: […]» (p. 11) | `0160`. `0100` queda para el mensaje del servicio |
| Prefijo de la respuesta | Sin prefijo | `ns2:` (p. 9) | `ns2:` |
| Lote con distintos tipos | `0363` al consultar | `0301` al recibir (p. 6) | `0301` |
| Lote con distintos RUC | No lo menciona | `0301` (p. 6) | `0301` |
| Tamaño del lote | 10.000 KB (`0270`) | 1000 KB comprimido (p. 6) | `0301` desde 1000 KB comprimido; `0270` para el mensaje |
| Consulta después de 48 horas | No lo menciona | `0364` (p. 10) | `0364` |
| Consulta por CDC | No lo menciona | Permitida si se perdió el número de lote (p. 6) | Permitida |
| `dTpoProces` | Mínimo 1 segundo | `0` en el ejemplo (p. 9) | `0` |
| Bloqueo del RUC | No lo menciona | De 10 a 60 minutos (p. 6) | Ver abajo |

**Bloqueo:** se aplica al recibir lotes, si se repite un CDC en el lote, si un CDC ya está en otro lote en proceso o si se reenvía el mismo lote. La Guía no dice cómo sube el tiempo: **el escalón de 10 minutos por reincidencia es una suposición**. Tampoco se bloquea por lotes vacíos o inválidos, porque sin leerlos no se puede saber de qué RUC vienen.

**Plazos reales:** la Guía recomienda consultar un lote a los 10 minutos y dice que puede tardar de 1 a 24 horas en momentos de carga. El simulador tarda 2 segundos por defecto (`SANDBOX_LOT_DELAY_MS`).

**Leyenda obligatoria en pruebas:** la Guía de Pruebas pide que el nombre del emisor y el primer ítem digan «DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA». No figura con un código de rechazo, así que el simulador no rechaza: lo anota en `GET /__sandbox/requests`.
