module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // @tca/contracts is authored for Node ESM, so its own imports carry a
    // `.js` extension that points at a `.ts` file. Node and vitest resolve
    // that; jest's resolver does not, and fails with "Cannot find module
    // './ticket.js'". Dropping the extension lets jest find the source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // `\\.pnpm` leads the allowlist on purpose. Under pnpm every dependency
  // path is node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/..., so a
  // pattern that does not permit `.pnpm` matches at that first segment and
  // the real package name is never reached — which left @react-native's own
  // ESM jest-preset untransformed and every suite failing to load.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@livekit/.*|livekit-client))',
  ],
};
