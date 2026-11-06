import { CallerProfile, TranscriptRef, type CreateTranscriptInput } from '@tca/contracts';

export interface AgentApiOptions {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
  /** Total tries per request, including the first. */
  attempts?: number;
}

/**
 * Generous, because of where this sits.
 *
 * fetchProfile is the first thing the agent does after joining a room, so a
 * single slow response ends the call before the caller hears anything. A live
 * call was lost this way on a contended laptop: the API answered, just not
 * within 10s, and the job crashed with a bare DOMException naming neither the
 * url nor the timeout.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;

/**
 * The agent's calls to our API that are not ticket operations.
 *
 * Ticket reads and writes go through TicketApiClient, which implements
 * TicketProvider. These two do not belong on that interface because Synergy
 * Interact will never serve them: the caller directory and the transcript
 * store are ours regardless of which ticketing system sits behind the API.
 */
export class AgentApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly attempts: number;

  constructor(private readonly options: AgentApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs =
      options.timeoutMs ?? positiveInt(process.env['AGENT_API_TIMEOUT_MS']) ?? DEFAULT_TIMEOUT_MS;
    this.attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  }

  /**
   * The caller's full profile, by subject.
   *
   * This is what makes the never-ask rule possible. The agent holds only the
   * `caller.subject` participant attribute, never a token belonging to the
   * caller, so the lookup is subject-keyed and authenticated as the service.
   */
  async fetchProfile(subject: string): Promise<CallerProfile> {
    const response = await this.request('GET', `/v1/users/${encodeURIComponent(subject)}`);
    return CallerProfile.parse(await response.json());
  }

  async saveTranscript(input: CreateTranscriptInput): Promise<TranscriptRef> {
    const response = await this.request('POST', '/v1/transcripts', input, [201]);
    return TranscriptRef.parse(await response.json());
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    okStatuses: number[] = [200],
  ): Promise<Response> {
    let lastTimeout: unknown;

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.options.serviceToken}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        // Only a timeout or a refused connection is worth another go. A
        // response the server actually sent is the server's answer, however
        // unwelcome, and retrying it would double a write.
        if (!isTransient(cause)) throw cause;
        lastTimeout = cause;
        continue;
      }

      if (!okStatuses.includes(response.status)) {
        throw new Error(
          `${method} ${path} failed with ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      }
      return response;
    }

    // Name the url and the budget: a wrong TICKET_API_URL and an overloaded
    // API are indistinguishable otherwise, and both are common.
    throw new Error(
      `${method} ${this.baseUrl}${path} timed out after ${this.attempts} ` +
        `attempt(s) of ${this.timeoutMs}ms. Is the API running and is ` +
        `TICKET_API_URL correct? (${describe(lastTimeout)})`,
    );
  }
}

function isTransient(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const { name, code } = cause as { name?: string; code?: unknown };

  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function positiveInt(raw: string | undefined): number | undefined {
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
