# sifen-sandbox

[![CI](https://github.com/nandres/sifen-sandbox/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nandres/sifen-sandbox/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue)](LICENSE)

Simulador local de **SIFEN**, la facturación electrónica de Paraguay. Probá tu integración desde cualquier lenguaje, sin certificado, sin habilitación y sin internet, con los mismos servicios SOAP y los mismos códigos de respuesta.

Para probar contra el ambiente oficial hace falta tramitar la habilitación en Marangatu y tener un certificado digital. Este simulador cubre lo anterior a ese paso: el desarrollo diario, el CI y las fallas difíciles de provocar de verdad, como un lote que tarda o un servidor caído.

> **Es un simulador.** Lo que aprueba no tiene valor fiscal, no se comunica con la DNIT y no garantiza que SIFEN apruebe el mismo documento. Lee [Fidelidad](#fidelidad) antes de confiar en un resultado.

## Qué hace

- **Atiende los 6 servicios** en las mismas rutas que SIFEN, así que alcanza con cambiar el host.
- **Valida de verdad:** XSD oficiales, firma XMLDSig, CDC, RUC, fechas, duplicados y hash del QR.
- **Responde con los códigos del Manual Técnico y las Notas Técnicas**, en el formato de las respuestas reales, y explica el rechazo.
- **Aplica las reglas de lotes de la DNIT:** un solo RUC y tipo por lote, bloqueo temporal del RUC por envíos duplicados y consulta hasta 48 horas.
- **Provoca fallas a pedido:** HTTP 503, conexión cortada, demoras, SOAP Fault y códigos como `0161`.
- **Mueve el reloj** para probar las reglas de 72 horas, 720 horas y 48 horas sin esperar.
- **Cada regla cita su fuente** en el manual: `GET /__sandbox/rules`.

Un rechazo trae el mensaje oficial y, entre corchetes, lo que hay que corregir:

```xml
<dCodRes>2501</dCodRes>
<dMsgRes>El hash del código QR incluido en la cadena de caracteres no corresponde al calculado [sandbox: cHashQR debe ser el SHA-256 en hexadecimal minúscula de los parámetros más el CSC]</dMsgRes>
```

## Empezar

Con Node.js 22 o superior:

```bash
git clone https://github.com/nandres/sifen-sandbox.git
cd sifen-sandbox
npm ci --ignore-scripts
npm run xsd:download
npm run build
npm start
```

Con Docker:

```bash
docker build -t sifen-sandbox .
docker run --rm -p 3900:3900 sifen-sandbox
```

Los XSD son material de la DNIT, así que no están en el repositorio: se bajan del sitio oficial.

Probalo con una consulta de RUC:

```bash
curl -s http://127.0.0.1:3900/de/ws/consultas/consulta-ruc.wsdl \
  -H 'Content-Type: application/soap+xml; charset=utf-8' \
  -d '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><rEnviConsRUC xmlns="http://ekuatia.set.gov.py/sifen/xsd"><dId>1</dId><dRUCCons>80000001</dRUCCons></rEnviConsRUC></soap:Body></soap:Envelope>'
```

## Conectar tu sistema

Cambiá `https://sifen-test.set.gov.py` por `http://127.0.0.1:3900`.

| Servicio | Ruta |
|---|---|
| `siRecepDE` | `/de/ws/sync/recibe.wsdl` |
| `siRecepLoteDE` | `/de/ws/async/recibe-lote.wsdl` |
| `siResultLoteDE` | `/de/ws/consultas/consulta-lote.wsdl` |
| `siConsDE` | `/de/ws/consultas/consulta.wsdl` |
| `siConsRUC` | `/de/ws/consultas/consulta-ruc.wsdl` |
| `siRecepEvento` | `/de/ws/eventos/evento.wsdl` |

Tu documento tiene que estar firmado, pero sirve cualquier certificado, incluso uno autofirmado. El QR debe apuntar a la consulta de pruebas y calcularse con un CSC genérico de la Guía de Pruebas de la DNIT: `0001` con `ABCD0000000000000000000000000000`, o `0002` con `EFGH0000000000000000000000000000`.

Si tu cliente exige HTTPS con certificado, como SIFEN, pasale un certificado de servidor:

```bash
SANDBOX_TLS_CERT=servidor.pem SANDBOX_TLS_KEY=servidor.key SANDBOX_TLS_CLIENT_CERT=request npm start
```

| Variable | Predeterminado | Para qué sirve |
|---|---|---|
| `SANDBOX_HOST` | `127.0.0.1` | Dirección donde escucha |
| `SANDBOX_PORT` | `3900` | Puerto |
| `SANDBOX_XSD_DIR` | `xsd` | Carpeta de los esquemas |
| `SANDBOX_CSCS` | Los genéricos | Códigos de seguridad, como `0001:AAA,0002:BBB` |
| `SANDBOX_LOT_DELAY_MS` | `2000` | Cuánto tarda un lote en procesarse |
| `SANDBOX_CHECK_CERT_RUC` | `false` | Exigir que el certificado mencione el RUC del emisor (`0142`) |
| `SANDBOX_TLS_CERT`, `SANDBOX_TLS_KEY` | | Activan HTTPS |
| `SANDBOX_TLS_CLIENT_CERT` | | `request` pide certificado de cliente, y acepta cualquiera |

## Provocar situaciones

Todo se maneja con la API de control, bajo `/__sandbox`. No tiene autenticación, por eso el simulador escucha solo en tu propia PC salvo que indiques otra cosa. No lo expongas a internet.

```bash
# Las próximas 2 recepciones devuelven HTTP 503
curl -X POST http://127.0.0.1:3900/__sandbox/faults \
  -d '{"service":"siRecepDE","kind":"http","status":503,"times":2}'

# Adelanta el reloj para probar la cancelación fuera de plazo
curl -X POST http://127.0.0.1:3900/__sandbox/clock \
  -d '{"now":"2026-11-08T10:00:00-03:00"}'

# Un emisor suspendido: sus documentos dan 1252
curl -X POST http://127.0.0.1:3900/__sandbox/ruc \
  -d '{"ruc":"80000001","estado":"SUS"}'
```

| Ruta | Qué hace |
|---|---|
| `GET /health` | Estado y hora del simulador |
| `GET /rules` | Todas las reglas, con su fuente |
| `GET /requests` | Historial de pedidos, con las reglas que aplicaron |
| `GET /documents` | Documentos aprobados |
| `GET /blocks` | RUC bloqueados y el motivo |
| `GET`, `POST /faults` | Ver o programar fallas |
| `POST /clock` | Fijar la hora, o volver a la real con `{"now":null}` |
| `POST /ruc` | Cargar un contribuyente: `estado`, `existe`, `usaServicioSincrono`, `puedeConsultar`, `razonSocial`, `facturaElectronica` (solo cambia la consulta de RUC) |
| `POST /timbrado` | Cargar un timbrado: `ruc`, `numero`, `activo` |
| `POST /lots/{id}/finish` | Terminar un lote ya |
| `POST /reset` | Borrar todo |

Una falla lleva `service` (o `*`), `times` (`-1` es hasta el reset) y un `kind`:

| `kind` | Efecto | Parámetro |
|---|---|---|
| `http` | Responde ese estado HTTP | `status` |
| `delay` | Demora y después procesa normal | `ms` |
| `drop` | Corta la conexión | |
| `soapFault` | Responde HTTP 500 con un SOAP Fault | |
| `code` | Responde con ese código del manual | `code`, como `0161` |

Por defecto, cualquier RUC con su dígito correcto existe, está activo y puede facturar, y se acepta cualquier timbrado. Cargá datos solo para los casos que quieras probar.

## Qué valida un documento

En este orden, y se detiene en el primer rechazo:

| Paso | Códigos |
|---|---|
| Forma del mensaje | `0105` `0106` `0104` `0107` `0160` `0101` `0163` |
| Esquema XSD oficial | `0160` |
| Firma y certificado | `0140` `0120` `0141` `0142` |
| CDC | `1003` `1000` |
| Tipo de emisión y de documento | `1050` `1051` `1100` |
| Duplicados | `1001` `1002` |
| Fechas | `1004` `1156` `1150` `1151` |
| Emisor | `1253` `1250` `1252` `1264` |
| Operación y receptor | `1216` `1213` `1300` `1335` `1314` `1334` `1331` `1333` `1321` |
| Timbrado | `1103` `1101` `1104` |
| Vigencia del certificado | `2450` |
| QR | `2500` `2501` `2502` |
| Aprobación | `0260`, o `1005` con observación si pasaron 72 horas desde la firma |

## Fidelidad

Hasta dónde se puede confiar en este simulador, sin exagerar:

- **Reglas:** salen del **Manual Técnico v150**, las **Notas Técnicas 001 a 027** que tocan lo que se simula y la **guía de buenas prácticas de 2024** de la DNIT. El detalle, nota por nota, está en [docs/NOTAS-TECNICAS.md](docs/NOTAS-TECNICAS.md). Para saber qué regla rigió en una fecha, mirá [sifen-kb](https://github.com/NetseWin/sifen-kb).
- **Vigencia:** el límite de `1321` cambia según la fecha de proceso, y se puede probar moviendo el reloj. El resto aplica las reglas de hoy, aunque muevas el reloj al pasado.
- **Esquemas:** son los oficiales, bajados de `ekuatia.set.gov.py`. El CI los compara cada semana contra [`schemas.lock.json`](schemas.lock.json), porque la DNIT puede cambiar un archivo sin cambiarle el nombre.
- **Respuestas:** se comprueban en las pruebas contra los mismos XSD oficiales.
- **QR:** reproduce el ejemplo resuelto del manual, incluido el hash de su §13.8.4.
- **Suposiciones:** el escalón de 10 minutos del bloqueo no sale de un documento oficial.
- **No comparado todavía con SIFEN real.** Si tenés acceso al ambiente de pruebas y encontrás una diferencia, [abrí un issue](https://github.com/nandres/sifen-sandbox/issues) con el código y la respuesta real.

Donde los documentos se contradicen, se eligió así (más en [docs/NOTAS-TECNICAS.md](docs/NOTAS-TECNICAS.md)):

| Tema | Contradicción | Elección |
|---|---|---|
| CDC encontrado | `0421` en §12.3.4.3, `0422` en §9.4 | `0422`, confirmado por la guía de 2024 |
| Dirección del QR | Con `www` en §13.8.4.4, sin `www` en §13.8.2 y la NT 10 | Sin `www` |
| Valor inválido en el DE | `0100` en §12.2.3, `0160` en la guía de 2024 | `0160` |
| Ruta de recepción | `recibe.wsd` en §7.10 | Se aceptan `.wsd` y `.wsdl` |
| Campo del DE en `rEnviDe` | `xDe` en §9.1, `xDE` en el XSD | `xDE` |

## Qué no hace

- **No valida:** cadena de confianza ni revocación del certificado, sumas de totales e IVA, catálogos de geografía o actividades, documentos asociados, ni el resto de las reglas del §12.4.
- **Servicios:** falta la consulta masiva de RUC de la NT 11.
- **Eventos:** solo la cancelación. Los demás responden HTTP 501 en vez de aprobarse sin simularlos.
- **WSDL:** no se publica. Sirve para clientes que arman el sobre SOAP directamente.
- **Persistencia:** todo vive en memoria y se pierde al reiniciar.
- **KuDE y contingencia:** no están. El manual todavía da la contingencia como futura.

## Desarrollo

```bash
npm run dev
npm run typecheck
npm test
```

Las pruebas no necesitan archivos secretos: generan sus certificados en cada corrida. Sí necesitan los XSD (`npm run xsd:download`).

## Licencia

[MIT](LICENSE). SIFEN y e-Kuatia pertenecen a la DNIT de Paraguay. Este es un proyecto independiente, sin relación con ella.

Hecho por **Marcos Arellano** · [marcos-arellano.vercel.app](https://marcos-arellano.vercel.app)
