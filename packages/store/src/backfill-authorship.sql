-- Reconstruye block_authorship desde el registro de operaciones.
--
-- Hace falta una sola vez, para las bases que existían antes de que la autoría
-- se materializara. No inventa nada: la mano de un bloque es el participante de
-- la última operación que escribió su texto, y eso ya está en `operations`.
--
-- `move_block` no cuenta, y es rule MovingLeavesTheHandAlone: archivar un bloque
-- no es haber escrito una palabra suya.
-- La última escritura de cada bloque se saca con una sola agrupación. Escrito
-- como subconsulta correlacionada —«la operación cuya secuencia es el máximo de
-- las suyas»— dice lo mismo y tarda casi cuatro minutos sobre el corpus, porque
-- recorre el registro entero una vez por bloque.
INSERT INTO block_authorship (block_id, participant_id, channel, written_at)
SELECT o.subject_id, o.participant_id, o.channel, o.applied_at
FROM operations o
JOIN blocks b ON b.id = o.subject_id
JOIN (
    SELECT subject_id, MAX(sequence) AS sequence
    FROM operations
    WHERE change_kind IN ('create_block', 'edit_block')
    GROUP BY subject_id
) ultima ON ultima.subject_id = o.subject_id AND ultima.sequence = o.sequence
WHERE o.change_kind IN ('create_block', 'edit_block')
ON CONFLICT (block_id) DO UPDATE SET
    participant_id = excluded.participant_id,
    channel        = excluded.channel,
    written_at     = excluded.written_at;
