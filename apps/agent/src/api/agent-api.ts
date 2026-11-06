import { CallerProfile, TranscriptRef, type CreateTranscriptInput } from '@tca/contracts';

export interface AgentApiOptions {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
}

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

  constructor(private readonly options: AgentApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
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
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.serviceToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!okStatuses.includes(response.status)) {
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    return response;
  }
}
