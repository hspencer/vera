/**
 * Dónde poner la cámara para que quepa lo que hay que ver.
 *
 * Vive aparte del dibujo porque es la parte que se ha roto tres veces y la
 * única que se puede comprobar sin un navegador: dada una caja y una lente,
 * salen unas coordenadas. Lo demás —qué caja, qué lente— lo sabe `render3d.ts`.
 *
 * @guarantee TheMapArrivesFramed
 */

/** Una caja alineada con los ejes, en coordenadas del grafo. */
export type Box = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

/** Desde dónde y hacia dónde mira la cámara. */
export type Framing = {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
};

/**
 * Cuánto aire se deja alrededor de lo encuadrado.
 *
 * La caja ya trae el tamaño real de los nombres, así que esto es holgura y no
 * corrección: sirve para que el borde del grafo no muera contra el canto del
 * panel, no para compensar una medida que se quedó corta. Cuando el margen
 * tenía que hacer de corrector hacía falta 1.35 y aun así no bastaba.
 */
export const MARGIN = 1.12;

/**
 * La cámara que hace caber `box` entera, mirándola de frente.
 *
 * La caja se mete en su esfera envolvente y la esfera se encuadra por
 * trigonometría: a distancia `radio / sen(semiángulo)` el borde de la esfera
 * cae justo sobre el borde del campo de visión. Se toma el menor de los dos
 * semiángulos —el vertical y el horizontal— porque el panel del mapa suele ser
 * más alto que ancho, y encuadrar sólo en vertical dejaría el grafo desbordando
 * por los lados.
 *
 * Se usa la esfera y no la caja porque la cámara puede girar después: lo que
 * cabe visto de frente tiene que seguir cabiendo visto de canto, y eso sólo lo
 * garantiza la envolvente redonda.
 *
 * @param box    Lo que hay que ver, con su tamaño real y no sólo sus centros.
 * @param fov    Campo de visión vertical de la cámara, en grados.
 * @param aspect Ancho partido por alto del panel.
 */
export function frame(box: Box, fov: number, aspect: number, margin = MARGIN): Framing {
  const lookAt = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };

  const half = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2;
  // Un solo nodo sin nombre visible tiene radio cero, y dividir por su seno
  // daría infinito. Un metro de nada es mejor que una cámara en el infinito.
  const radius = half > 0 ? half : 1;

  // Una lente inverosímil —cero grados, o ciento ochenta— haría un seno de cero
  // y la cámara se iría al infinito o al centro del grafo. Se acota antes.
  const fovSafe = Math.min(Math.max(Number.isFinite(fov) ? fov : 50, 1), 179);
  const aspectSafe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;

  const halfV = ((fovSafe * Math.PI) / 180) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspectSafe);
  const halfAngle = Math.min(halfV, halfH);

  const distance = (radius / Math.sin(halfAngle)) * margin;

  return { position: { x: lookAt.x, y: lookAt.y, z: lookAt.z + distance }, lookAt };
}

/**
 * Si la esfera de radio `radius` cabe entera vista desde `distance`.
 *
 * Es la pregunta que el encuadre contesta, escrita al derecho para poder
 * comprobarla: la mitad del ángulo que ocupa la esfera es `asen(radio /
 * distancia)`, y tiene que caber en el semiángulo de la lente.
 */
export function fits(radius: number, distance: number, fov: number, aspect: number): boolean {
  if (distance <= radius) return false;
  const halfV = ((fov * Math.PI) / 180) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  return Math.asin(radius / distance) <= Math.min(halfV, halfH);
}
