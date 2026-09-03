# Acceder a Vera desde tu teléfono u otro equipo

Vera vive en un solo computador: el que la tiene instalada. Este tutorial es
para cuando quieres abrirla desde otro aparato —tu teléfono, una tablet, un
segundo computador— sin exponerla a internet. La herramienta para eso es
[Tailscale](https://tailscale.com): una red privada entre tus propios
dispositivos. Nadie fuera de ella puede alcanzar tu Vera.

No hace falta saber de redes. Son cinco pasos y uno de ellos usa una sola línea
de terminal.

> Esto es un tutorial de uso. Si quieres entender **por qué** Tailscale es hoy
> la única frontera de seguridad de Vera —y qué implica eso—, lee
> [Exponer Vera](exponer-vera.md).

## Antes de empezar

- El computador donde instalaste Vera tiene que estar **encendido y con Vera
  abierta** para que puedas alcanzarla desde otro lado. Si lo apagas o lo pones
  a dormir, Vera deja de responder hasta que lo enciendas de nuevo.
- Vera no necesita estar conectada a Wi-Fi especial ni tener una IP fija:
  Tailscale se encarga de que tus dispositivos se encuentren.

## 1. Instala Tailscale en el computador donde vive Vera

1. Ve a [tailscale.com/download](https://tailscale.com/download) y descarga la
   versión para tu sistema (Windows o macOS).
2. Instálala como cualquier programa y ábrela.
3. Inicia sesión — con tu cuenta de Google, Microsoft, GitHub o un correo. La
   primera vez que lo haces, Tailscale crea tu red privada (tu *tailnet*).

Ese computador ya es parte de tu tailnet. No necesitas configurar nada más ahí.

## 2. Instala Tailscale en tu teléfono

1. Descárgala desde App Store (iPhone) o Google Play (Android): busca
   «Tailscale».
2. Ábrela e inicia sesión **con la misma cuenta** que usaste en el paso 1.

Ahora tu teléfono y el computador de Vera están en la misma red privada, sin
importar si están en el mismo Wi-Fi o en extremos distintos del mundo.

## 3. Publica Vera dentro de tu tailnet

Este es el único paso que usa una terminal. Ábrela en el computador donde vive
Vera:

- **Windows**: busca «PowerShell» en el menú de inicio.
- **macOS**: abre «Terminal» desde Spotlight (⌘+Espacio, escribe «Terminal»).

Y escribe:

```sh
tailscale serve --bg 4173
```

Esto le dice a Tailscale «entrega lo que sirve el puerto 4173 —que es donde
escucha Vera— a los demás equipos de mi tailnet». No abre nada a internet: sólo
a tus propios dispositivos.

Tailscale responde con una dirección parecida a esta:

```
https://mi-computador.mi-tailnet.ts.net
```

Anótala: es la dirección de tu Vera dentro de la tailnet.

## 4. Abre Vera desde tu teléfono

Con Vera abierta en el computador, entra a esa misma dirección desde el
navegador de tu teléfono. Deberías ver tu memoria, igual que en el computador.

Si no carga, revisa que:

- el computador esté encendido y Vera abierta;
- ambos dispositivos hayan iniciado sesión en Tailscale con la misma cuenta;
- escribiste la dirección completa, con `https://`.

## 5. Instálala como aplicación (PWA)

Vera es una PWA: se instala como una aplicación normal, con su ícono propio, sin
pasar por ninguna tienda.

**iPhone (Safari):**

1. Abre la dirección de Vera en Safari.
2. Toca el botón de compartir (el cuadrado con la flecha hacia arriba).
3. Elige «Agregar a pantalla de inicio».

**Android (Chrome):**

1. Abre la dirección de Vera en Chrome.
2. Toca el menú (⋮) en la esquina superior derecha.
3. Elige «Instalar aplicación» o «Agregar a pantalla de inicio».

Desde ahora, un ícono de Vera en tu teléfono la abre directamente, con la misma
memoria que hay en tu computador.

## Qué esperar

- Todo lo que escribas desde el teléfono se guarda en la misma memoria del
  computador: no hay dos copias que sincronizar.
- Si cierras Vera en el computador o lo apagas, la aplicación del teléfono deja
  de responder hasta que vuelvas a abrirla allá.
- Cualquier dispositivo que agregues a tu tailnet con la misma cuenta puede
  alcanzar tu Vera de la misma manera, sin repetir el paso 3.

## Una cosa importante sobre quién puede entrar

Vera todavía no le pide credencial a quien llega por este camino: **cualquier
dispositivo de tu tailnet tiene el mismo acceso que tú**, lectura y escritura
completas. Eso es intencional mientras Vera no autentica personas — la propia
tailnet es hoy la única puerta — pero significa que no debes agregar a tu
tailnet un dispositivo en el que no confíes tanto como en tu propio computador.
Los detalles y lo que falta por construir están en
[Exponer Vera](exponer-vera.md).

## Ver también

- [Exponer Vera](exponer-vera.md) — los tres modos de estar alcanzable y por
  qué la tailnet es hoy la única frontera.
- [Portabilidad](portabilidad.md#6-exponerla-fuera-de-tu-máquina) — la misma
  publicación, desde el punto de vista de quien levanta Vera desde el código
  fuente en vez de instalarla como aplicación.
- [Documentación de Tailscale](https://tailscale.com/kb/) — para redes con más
  de un computador, invitar a otra persona a tu tailnet, o dudas específicas de
  tu sistema operativo.
