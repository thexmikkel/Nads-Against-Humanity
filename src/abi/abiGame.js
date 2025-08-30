// src/abi/abiGame.js — matches MonadCah v3.4 (identity + one-tx join)
const abi = [
  // Events
  'event FinalScores(uint256 indexed gameId, address[] players, uint32[] scores, address[] winners)',
  'event IdentityLinked(uint256 indexed gameId, address indexed embedded, address indexed gamesID)',

  // Constants & views
  'function MAX_GAME_FEE() view returns (uint256)',
  'function gameFee() view returns (uint256)',
  'function feePot() view returns (uint256)',
  'function reservedPrize() view returns (uint256)',
  'function gameCount() view returns (uint256)',
  'function minPlayersToStart() view returns (uint8)',
  'function minMaxPlayers() view returns (uint8)',
  'function maxMaxPlayers() view returns (uint8)',
  'function minLobbyExpiry() view returns (uint32)',
  'function maxLobbyExpiry() view returns (uint32)',

  // Mappings/helpers
  'function codeToGameId(bytes32) view returns (uint256)',
  'function activeGameOf(address) view returns (uint256)',
  'function finalizeNonce(uint256) view returns (uint256)',
  'function delegateOf(uint256,address) view returns (address delegate, uint64 expiresAt)',
  'function delegate(uint256,address) view returns (address)',
  'function delegateExpiry(uint256,address) view returns (uint64)',

  // 🔹 Identity (new)
  'function identityOf(uint256 gameId, address embedded) view returns (address)',
  'function setIdentityForThisGame(uint256 gameId, address gamesID)',

  // Game views
  'function getGameStatus(uint256) view returns (uint8)',
  'function getPlayers(uint256) view returns (address[])',
  'function getTotals(address) view returns (uint64 score, uint32 gamesPlayed)',
  'function getGameMeta(uint256) view returns (address creator, bytes32 inviteCodeHash, uint8 maxPlayers, bool usePrize, uint64 createdAt, uint64 expiryTs, uint256 prizeAmount, uint256 feeSnapshot, bool started, bool finished, bool cancelled)',
  'function rejoinInfo(address) view returns (bool canReconnect, uint256 gameId, uint8 status, uint64 lobbyExpiresAt)',
  'function canJoinByCode(bytes32,address) view returns (bool ok, uint256 gameId, string reason)',

  // Admin
  'function setGameFee(uint256 newFee)',
  'function setLimits(uint8,uint8,uint32,uint32,uint8)',
  'function pause()',
  'function unpause()',
  'function withdrawTreasury(address to, uint256 amount)',
  'function setLeaderboard(address addr, bool enabled)',

  // Lifecycle
  'function createGame(bytes32 inviteCodeHash, uint8 maxPlayers, uint32 lobbyExpirySeconds, bool usePrize, uint256 prizeAmount) payable returns (uint256 gameId)',
  'function joinGameByCode(bytes32 inviteCodeHash)',
  'function joinGame(uint256 gameId)',
  // 🔹 One-tx join (new)
  'function joinWithIdentity(uint256 gameId, address gamesID) payable',
  'function leaveLobby(uint256 gameId)',
  'function forceStart(uint256 gameId)',
  'function tickLobby(uint256 gameId)',

  // Finalize (A)
  'function finalizeGame((uint256 gameId,address[] players,uint32[] scores,address[] winners,uint32 roundCount,uint256 nonce,uint256 deadline,bytes32 roundsHash) p, bytes sigJudge, bytes[] sigPlayers, (address player,uint256 gameId,bytes32 inviteCodeHash,uint256 nonce,uint256 deadline,bool ackSuddenDeath,bool ackAutoPick,bytes signature)[] tickets)',

  // Delegate flow (B2)
  'function setDelegateApproval(uint256 gameId, (address player,address delegate,uint256 expiresAt,bytes signature) a)',
  'function joinGameWithApproval(uint256 gameId, (address player,address delegate,uint256 expiresAt,bytes signature) a)',
  'function joinGameByCodeWithApproval(bytes32 inviteCodeHash, (address player,address delegate,uint256 expiresAt,bytes signature) a)',
  'function finalizeByDelegate((uint256 gameId,address[] players,uint32[] scores,address[] winners,uint32 roundCount,uint256 nonce,uint256 deadline,bytes32 roundsHash) p)',

  // External Leaderboard push
  'function externalPushScores(uint256 gameId, address[] players, uint32[] scores, bytes32 requestId)',

  // Final-record bookkeeping (reads)
  'function finalHash(uint256) view returns (bytes32)',
  'function scoresPushed(uint256) view returns (bool)',
  'function finalPlayersCount(uint256) view returns (uint16)',
  'function pushedPlayersCount(uint256) view returns (uint16)',
  'function finalRecorded(uint256,address) view returns (bool)',
  'function finalScore(uint256,address) view returns (uint32)',
  'function pushedScore(uint256,address) view returns (bool)',
];

export default abi;
