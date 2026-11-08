/**
 * Stands in for node:crypto on the device.
 *
 * @tca/contracts' barrel re-exports deriveIdempotencyKey, which hashes with
 * node:crypto, and React Native ships no Node standard library — so importing
 * anything from the barrel used to fail the bundle outright. The app never
 * calls that function: idempotency keys are derived by the agent, server-side,
 * which is the whole point of deriving them from the call rather than letting
 * a client invent one.
 *
 * So this exists only to let the import resolve. It throws if anything ever
 * actually calls it, because a client-side key that silently differed from the
 * agent's would defeat the duplicate-ticket defence rather than fail visibly.
 */
function unavailable() {
  throw new Error(
    'node:crypto is not available in React Native. Idempotency keys are derived ' +
      'by the agent (see deriveIdempotencyKey in @tca/contracts); the app must ' +
      'never compute one. If you need hashing on the device, add expo-crypto ' +
      'and map it in metro.config.js rather than widening this shim.',
  );
}

module.exports = {
  createHash: unavailable,
  createHmac: unavailable,
  randomBytes: unavailable,
  randomUUID: unavailable,
};
