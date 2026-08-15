import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface YoutubeTranscriptChoice {
  language: string;
  label: string;
  source: 'published' | 'automatic';
  translated: boolean;
  originalLanguage: string | null;
}

interface YoutubeInfo {
  id: string;
  title?: string;
  uploader?: string;
  channel?: string;
  description?: string;
  language?: string;
  subtitles?: Record<string, CaptionFormat[]>;
  automatic_captions?: Record<string, CaptionFormat[]>;
}

interface CaptionFormat { ext?: string; url?: string; name?: string }

function youtubeUrl(raw: string): string {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'youtu.be' && host !== 'youtube.com' && host !== 'm.youtube.com') {
    throw new Error('la dirección no es de YouTube');
  }
  return url.toString();
}

async function infoFor(raw: string): Promise<YoutubeInfo> {
  const url = youtubeUrl(raw);
  const { stdout } = await run('yt-dlp', ['--dump-single-json', '--skip-download', '--no-warnings', url], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30_000,
  });
  return JSON.parse(stdout) as YoutubeInfo;
}

function languageName(code: string, supplied?: string): string {
  if (supplied?.trim()) return supplied.trim();
  try {
    return new Intl.DisplayNames(['es'], { type: 'language' }).of(code.replace(/-orig$/, '')) ?? code;
  } catch {
    return code;
  }
}

export async function youtubeTranscriptChoices(raw: string): Promise<{
  video: { id: string; title: string; author: string; description: string; originalLanguage: string | null };
  choices: YoutubeTranscriptChoice[];
}> {
  const info = await infoFor(raw);
  const original = info.language?.split('-')[0] ?? null;
  const choices: YoutubeTranscriptChoice[] = [];
  for (const [language, formats] of Object.entries(info.subtitles ?? {})) {
    choices.push({ language, label: languageName(language, formats[0]?.name), source: 'published', translated: false, originalLanguage: original });
  }
  for (const [language, formats] of Object.entries(info.automatic_captions ?? {})) {
    const bare = language.replace(/-orig$/, '');
    choices.push({
      language,
      label: languageName(bare, formats[0]?.name),
      source: 'automatic',
      translated: original !== null && bare !== original && language !== `${original}-orig`,
      originalLanguage: original,
    });
  }
  choices.sort((a, b) => Number(a.translated) - Number(b.translated) || a.label.localeCompare(b.label, 'es'));
  return {
    video: {
      id: info.id,
      title: info.title ?? info.id,
      author: info.uploader ?? info.channel ?? '',
      description: info.description ?? '',
      originalLanguage: original,
    },
    choices,
  };
}

export async function youtubeTranscript(raw: string, language: string, source: 'published' | 'automatic'): Promise<{
  video: { id: string; title: string; author: string; originalLanguage: string | null };
  choice: YoutubeTranscriptChoice;
  segments: { startMs: number; durationMs: number; text: string }[];
}> {
  const info = await infoFor(raw);
  const tracks = source === 'published' ? info.subtitles : info.automatic_captions;
  const formats = tracks?.[language];
  if (formats === undefined) throw new Error('esa pista ya no está disponible');
  const format = formats.find((one) => one.ext === 'json3' && one.url) ?? formats.find((one) => one.url);
  if (format?.url === undefined) throw new Error('YouTube no entregó una pista legible');
  const answer = await fetch(format.url, { signal: AbortSignal.timeout(30_000) });
  if (!answer.ok) throw new Error(`YouTube rechazó la pista (${answer.status})`);
  const body = await answer.json() as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] };
  const segments = (body.events ?? []).flatMap((event) => {
    const text = (event.segs ?? []).map((part) => part.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    return text === '' ? [] : [{ startMs: event.tStartMs ?? 0, durationMs: event.dDurationMs ?? 0, text }];
  });
  const original = info.language?.split('-')[0] ?? null;
  const bare = language.replace(/-orig$/, '');
  return {
    video: { id: info.id, title: info.title ?? info.id, author: info.uploader ?? info.channel ?? '', originalLanguage: original },
    choice: {
      language,
      label: languageName(bare, formats[0]?.name),
      source,
      translated: source === 'automatic' && original !== null && bare !== original && language !== `${original}-orig`,
      originalLanguage: original,
    },
    segments,
  };
}
