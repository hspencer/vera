// Una fecha dicha como se dice de viva voz.
//
// Estaba escrita dos veces —en la página de la puerta y en la de un servicio— y
// no decían lo mismo: una bajaba hasta los minutos y la otra empezaba en «hoy».
// Dos maneras de decir la misma cosa en la misma interfaz es de las diferencias
// que nadie decide y todo el mundo nota.
//
// Se queda con la que distingue más. «Hace 12 min» y «hoy» son la misma verdad y
// no sirven igual: cuando lo que se mira es si algo acaba de pasar —una clave
// que se usó, un dibujo que se retocó— la hora del día es justamente el dato.

/**
 * Cuánto hace, en las unidades en que una persona lo diría.
 *
 * A partir del mes se pasa a la fecha: «hace 74 días» obliga a contar hacia atrás
 * para saber de qué se está hablando, y una fecha no.
 */
export function when(stamp: number | null): string {
  if (stamp === null) return 'nunca';
  const minutes = Math.floor((Date.now() - stamp) / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return new Date(stamp).toISOString().slice(0, 10);
}
