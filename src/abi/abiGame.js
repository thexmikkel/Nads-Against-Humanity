// src/abi/abiGame.js
export default [
  // ===== Views used by UI =====
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getPlayers","outputs":[{"internalType":"address[]","name":"","type":"address[]"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getGameStatus","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"minPlayersToStart","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getGameMeta","outputs":[
    {"internalType":"address","name":"creator","type":"address"},
    {"internalType":"bytes32","name":"inviteCodeHash","type":"bytes32"},
    {"internalType":"uint8","name":"maxPlayers","type":"uint8"},
    {"internalType":"bool","name":"usePrize","type":"bool"},
    {"internalType":"uint64","name":"createdAt","type":"uint64"},
    {"internalType":"uint64","name":"expiryTs","type":"uint64"},
    {"internalType":"uint256","name":"prizeAmount","type":"uint256"},
    {"internalType":"uint256","name":"feeSnapshot","type":"uint256"},
    {"internalType":"bool","name":"started","type":"bool"},
    {"internalType":"bool","name":"finished","type":"bool"},
    {"internalType":"bool","name":"cancelled","type":"bool"}
  ],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"bytes32","name":"inviteCodeHash","type":"bytes32"},{"internalType":"address","name":"player","type":"address"}],"name":"canJoinByCode","outputs":[
    {"internalType":"bool","name":"ok","type":"bool"},
    {"internalType":"uint256","name":"gameId","type":"uint256"},
    {"internalType":"string","name":"reason","type":"string"}
  ],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"address","name":"player","type":"address"}],"name":"rejoinInfo","outputs":[
    {"internalType":"bool","name":"canReconnect","type":"bool"},
    {"internalType":"uint256","name":"gameId","type":"uint256"},
    {"internalType":"uint8","name":"status","type":"uint8"},
    {"internalType":"uint64","name":"lobbyExpiresAt","type":"uint64"}
  ],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"gameFee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},

  // 🔹 Public mapping getters
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"finalizeNonce","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"codeToGameId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"}],"name":"delegate","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"}],"name":"delegateExpiry","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},

  // ===== One-tx flows =====
  {"inputs":[
    {"internalType":"bytes32","name":"inviteCodeHash","type":"bytes32"},
    {"internalType":"uint8","name":"maxPlayers","type":"uint8"},
    {"internalType":"uint32","name":"lobbyExpirySeconds","type":"uint32"},
    {"internalType":"bool","name":"usePrize","type":"bool"},
    {"internalType":"uint256","name":"prizeAmount","type":"uint256"},
    {"internalType":"address","name":"gamesID","type":"address"},
    {"components":[{"internalType":"uint64","name":"delegateExpiry","type":"uint64"}],"internalType":"struct MonadNAHv4.OneTxSetup","name":"s","type":"tuple"}
  ],"name":"createGameWithSetup","outputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"stateMutability":"payable","type":"function"},
  {"inputs":[
    {"internalType":"uint256","name":"gameId","type":"uint256"},
    {"internalType":"address","name":"gamesID","type":"address"},
    {"components":[{"internalType":"uint64","name":"delegateExpiry","type":"uint64"}],"internalType":"struct MonadNAHv4.OneTxSetup","name":"s","type":"tuple"}
  ],"name":"joinWithSetup","outputs":[],"stateMutability":"nonpayable","type":"function"},

  // ===== Lobby actions =====
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"forceStart","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"tickLobby","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"leaveLobby","outputs":[],"stateMutability":"nonpayable","type":"function"},

  // ===== Delegate convenience =====
  {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"},{"internalType":"address","name":"player","type":"address"}],"name":"delegateOf","outputs":[{"internalType":"address","name":"" ,"type":"address"},{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},

  // ===== Relayer + roles =====
  {"inputs":[],"name":"globalRelayer","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"}],"name":"relayerConsent","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"hasRole","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},

  // ===== 🔸 Finalize by delegate (add this) =====
  {"inputs":[{"components":[
      {"internalType":"uint256","name":"gameId","type":"uint256"},
      {"internalType":"address[]","name":"players","type":"address[]"},
      {"internalType":"uint32[]","name":"scores","type":"uint32[]"},
      {"internalType":"address[]","name":"winners","type":"address[]"},
      {"internalType":"uint32","name":"roundCount","type":"uint32"},
      {"internalType":"uint256","name":"nonce","type":"uint256"},
      {"internalType":"uint256","name":"deadline","type":"uint256"},
      {"internalType":"bytes32","name":"roundsHash","type":"bytes32"}
  ],"internalType":"struct MonadNAHv4.FinalizePayload","name":"p","type":"tuple"}],
   "name":"finalizeByDelegate","outputs":[],"stateMutability":"nonpayable","type":"function"},

  // ===== Leaderboard push =====
  {"inputs":[
    {"internalType":"uint256","name":"gameId","type":"uint256"},
    {"internalType":"address[]","name":"players","type":"address[]"},
    {"internalType":"uint32[]","name":"scores","type":"uint32[]"},
    {"internalType":"bytes32","name":"requestId","type":"bytes32"}
  ],"name":"externalPushScores","outputs":[],"stateMutability":"nonpayable","type":"function"},

  // ===== Events =====
  {"anonymous":false,"inputs":[
    {"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"},
    {"indexed":true,"internalType":"bytes32","name":"inviteCodeHash","type":"bytes32"},
    {"indexed":true,"internalType":"address","name":"creator","type":"address"},
    {"indexed":false,"internalType":"bool","name":"usePrize","type":"bool"},
    {"indexed":false,"internalType":"uint256","name":"prizeAmount","type":"uint256"},
    {"indexed":false,"internalType":"uint256","name":"gameFee","type":"uint256"}
  ],"name":"GameCreated","type":"event"},
  {"anonymous":false,"inputs":[
    {"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"},
    {"indexed":true,"internalType":"address","name":"player","type":"address"},
    {"indexed":false,"internalType":"uint256","name":"playersNow","type":"uint256"}
  ],"name":"PlayerJoined","type":"event"},
  {"anonymous":false,"inputs":[
    {"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"},
    {"indexed":false,"internalType":"uint64","name":"startTs","type":"uint64"}
  ],"name":"GameStarted","type":"event"},
  {"anonymous":false,"inputs":[
    {"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"},
    {"indexed":false,"internalType":"uint8","name":"status","type":"uint8"},
    {"indexed":false,"internalType":"uint64","name":"endTs","type":"uint64"}
  ],"name":"GameEnded","type":"event"}
]
