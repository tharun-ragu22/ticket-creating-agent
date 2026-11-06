import { randomUUID } from 'node:crypto';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import type { CallerProfile } from '@tca/contracts';
import type { ApiConfig } from '../config.js';

export interface ConnectionDetails {
  server_url: string;
  participant_token: string;
  room_name: string;
}

export interface MintOptions {
  /** The only client-supplied value we honour. */
  roomName?: string | undefined;
}

/**
 * Mints a LiveKit join token for a verified caller.
 *
 * Note what this function cannot do: there is no parameter for an identity, a
 * display name or attributes. They are derived from the profile the caller's
 * bearer token resolved to, so there is no code path by which a request body
 * could influence them. That is the structural half of the defence; the test
 * in test/connection-details.test.ts is the other half.
 */
export async function mintConnectionDetails(
  config: ApiConfig,
  profile: CallerProfile,
  options: MintOptions = {},
): Promise<ConnectionDetails> {
  const roomName = options.roomName?.trim() || `call-${profile.subject}-${randomUUID().slice(0, 8)}`;

  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: profile.subject,
    name: profile.displayName,
    // Attributes are readable by every participant in the room, so they carry
    // lookup keys only. The profile itself travels server-to-server.
    attributes: {
      'caller.subject': profile.subject,
      'caller.tenant': profile.tenantId,
    },
    ttl: '30m',
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // Explicit dispatch. Setting ServerOptions.agentName on the worker disables
  // automatic dispatch entirely, so without this the agent never joins.
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: config.livekit.agentName })],
  });

  return {
    // snake_case is not a style choice: LiveKit's TokenSource.endpoint parses
    // these exact keys, and a camelCase response yields an empty token with no
    // error anywhere.
    server_url: config.livekit.url,
    participant_token: await token.toJwt(),
    room_name: roomName,
  };
}
