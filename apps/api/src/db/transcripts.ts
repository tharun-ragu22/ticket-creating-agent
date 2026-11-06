import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  TranscriptTurn,
  type CreateTranscriptInput,
  type SqlClient,
  type StoredTranscript,
  type TranscriptStore,
} from '@tca/contracts';

export { CreateTranscriptInput } from '@tca/contracts';

export class SqlTranscriptStore implements TranscriptStore {
  constructor(private readonly sql: SqlClient) {}

  async create(input: CreateTranscriptInput): Promise<StoredTranscript> {
    const id = `tr_${randomUUID()}`;
    const { rows } = await this.sql.query<{ created_at: Date | string }>(
      `INSERT INTO transcripts (id, room_name, session_id, caller_subject, turns)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING created_at`,
      [id, input.roomName, input.sessionId, input.callerSubject, JSON.stringify(input.turns)],
    );

    return { ...input, id, createdAt: iso(rows[0]!.created_at) };
  }

  get(id: string): Promise<StoredTranscript | null> {
    return this.selectOne(`SELECT * FROM transcripts WHERE id = $1`, [id]);
  }

  /** Latest transcript for a room, so the board can link one without an id. */
  findByRoom(roomName: string): Promise<StoredTranscript | null> {
    return this.selectOne(
      `SELECT * FROM transcripts WHERE room_name = $1 ORDER BY created_at DESC LIMIT 1`,
      [roomName],
    );
  }

  private async selectOne(sql: string, params: unknown[]): Promise<StoredTranscript | null> {
    const { rows } = await this.sql.query<TranscriptRow>(sql, params);
    const row = rows[0];
    return row ? hydrate(row) : null;
  }
}

interface TranscriptRow {
  id: string;
  room_name: string;
  session_id: string;
  caller_subject: string;
  turns: unknown;
  created_at: Date | string;
}

function hydrate(row: TranscriptRow): StoredTranscript {
  const turns = typeof row.turns === 'string' ? JSON.parse(row.turns) : row.turns;
  return {
    id: row.id,
    roomName: row.room_name,
    sessionId: row.session_id,
    callerSubject: row.caller_subject,
    turns: z.array(TranscriptTurn).parse(turns),
    createdAt: iso(row.created_at),
  };
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
