import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { transcribeAudio } from '../src/transcribe.ts';

describe('transcripción completa', () => {
  // @guarantee TheWholeRecordingIsTranscribed
  it('lee el texto completo que whisper escribe, no un stdout truncado', async () => {
    const work = await mkdtemp(join(tmpdir(), 'vera-transcribe-test-'));
    const ffmpeg = join(work, 'ffmpeg');
    const whisper = join(work, 'whisper-cli');
    const model = join(work, 'model.bin');

    await writeFile(
      ffmpeg,
      '#!/bin/sh\nout=""\nfor arg in "$@"; do out="$arg"; done\nprintf audio > "$out"\n',
    );
    await writeFile(
      whisper,
      '#!/bin/sh\nout=""\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "-of" ]; then shift; out="$1"; fi\n  shift\ndone\nprintf "primera parte\\nsegunda parte\\n" > "${out}.txt"\nprintf "primera parte\\n"\n',
    );
    await writeFile(model, 'modelo');
    await chmod(ffmpeg, 0o755);
    await chmod(whisper, 0o755);

    try {
      const result = await transcribeAudio(new Uint8Array([1, 2, 3]), {
        ffmpeg,
        command: whisper,
        model,
      });
      assert.deepEqual(result, { text: 'primera parte segunda parte' });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
