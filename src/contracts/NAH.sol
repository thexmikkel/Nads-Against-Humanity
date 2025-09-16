// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl}     from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable}          from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard}   from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ECDSA}             from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712}            from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface ILeaderboard {
    function updatePlayerData(address player, uint256 scoreAmount, uint256 transactionAmount) external;
}

contract MonadNAHv4 is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    // New globals
    address public globalRelayer;
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    // ===== Roles =====
    bytes32 public constant DEV_ROLE       = keccak256("DEV_ROLE");
    bytes32 public constant GUARDIAN_ROLE  = keccak256("GUARDIAN_ROLE");
    bytes32 public constant SUBMITTER_ROLE = keccak256("SUBMITTER_ROLE");

    // ===== Fees & limits =====
    uint256 public constant MAX_GAME_FEE = 0.5 ether;
    uint256 public gameFee;
    uint256 public feePot;
    uint256 public reservedPrize;

    uint8  public minPlayersToStart = 3;
    uint8  public minMaxPlayers    = 3;
    uint8  public maxMaxPlayers    = 10;
    uint32 public minLobbyExpiry   = 5 minutes;
    uint32 public maxLobbyExpiry   = 30 minutes;

    // ===== Game state =====
    enum GameStatus { None, Lobby, Started, Finished, Cancelled }

    struct Game {
        address creator;
        bytes32 inviteCodeHash;
        uint8   maxPlayers;
        bool    usePrize;
        uint64  createdAt;
        uint64  expiryTs;
        uint256 prizeAmount;
        uint256 feeSnapshot;
        bool    started;
        bool    finished;
        bool    cancelled;
        address[] players;
        mapping(address => bool) isPlayer;
    }

    uint256 public gameCount;
    mapping(uint256 => Game) private games;
    mapping(address => uint256) public activeGameOf;

    // Per-game identity mapping: embedded → Games-ID
    mapping(uint256 => mapping(address => address)) public identityOf;

    // Per-game consent for the *current* globalRelayer
    mapping(uint256 => mapping(address => bool)) public relayerConsent;

    // Lobby code → gameId
    mapping(bytes32 => uint256) public codeToGameId;

    // Totals (inside this game contract)
    struct Totals { uint64 score; uint32 gamesPlayed; }
    mapping(address => Totals) public totals;

    // Finalization replay
    mapping(uint256 => uint256) public finalizeNonce;

    // ===== EIP-712 =====
    bytes32 public constant JOIN_TICKET_TYPEHASH = keccak256(
        "JoinTicket(address player,uint256 gameId,bytes32 inviteCodeHash,uint256 nonce,uint256 deadline,bool ackSuddenDeath,bool ackAutoPick)"
    );
    bytes32 public constant SESSION_AUTH_TYPEHASH = keccak256(
        "SessionAuth(address player,uint256 gameId,bytes32 sessionPubKey,uint256 expiresAt)"
    );
    bytes32 public constant FINALIZATION_TYPEHASH = keccak256(
        "Finalization(uint256 gameId,address[] players,uint32[] scores,address[] winners,uint32 roundCount,uint256 nonce,uint256 deadline,bytes32 roundsHash)"
    );
    bytes32 public constant DELEGATE_APPROVAL_TYPEHASH = keccak256(
        "DelegateApproval(address player,address delegate,uint256 gameId,uint256 expiresAt)"
    );


    // ===== Events =====
    event GameCreated(uint256 indexed gameId, bytes32 indexed inviteCodeHash, address indexed creator, bool usePrize, uint256 prizeAmount, uint256 gameFee);
    event GameFeePaid(uint256 indexed gameId, address indexed payer, uint256 amount);
    event PlayerJoined(uint256 indexed gameId, address indexed player, uint256 playersNow);
    event GameStarted(uint256 indexed gameId, uint64 startTs);
    event FinalScores(uint256 indexed gameId, address[] players, uint32[] scores, address[] winners);
    event GameEnded(uint256 indexed gameId, GameStatus status, uint64 endTs);
    event PrizePaid(uint256 indexed gameId, address indexed to, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event GameFeeUpdated(uint256 oldFee, uint256 newFee, uint256 timestamp);
    event GameCancelled(uint256 indexed gameId, bytes32 reason);
    event LimitsUpdated(uint8 minMaxPlayers, uint8 maxMaxPlayers, uint32 minLobbyExpiry, uint32 maxLobbyExpiry, uint8 minPlayersToStart);
    event PlayerLeft(uint256 indexed gameId, address indexed player, uint256 playersNow);
    event IdentityLinked(uint256 indexed gameId, address indexed embedded, address indexed gamesID);

    // ===== Leaderboard wiring =====
    address public leaderboard;
    bool    public leaderboardEnabled;

    mapping(uint256 => bytes32) public finalHash;
    mapping(uint256 => bool)    public scoresPushed;
    mapping(bytes32 => bool)    public seenExternalPush;

    mapping(uint256 => mapping(address => bool))   public finalRecorded;
    mapping(uint256 => mapping(address => uint32)) public finalScore;
    mapping(uint256 => mapping(address => bool))   public pushedScore;
    mapping(uint256 => uint16) public finalPlayersCount;
    mapping(uint256 => uint16) public pushedPlayersCount;

    event LeaderboardSet(address indexed leaderboard, bool enabled);
    event LeaderboardPushed(uint256 indexed gameId, address indexed player);
    event LeaderboardPushOk(uint256 indexed gameId);
    event LeaderboardPushFailed(uint256 indexed gameId, address indexed player, bytes reason);

    constructor(uint256 initialGameFee) EIP712("MonadCAH", "1") {
        require(initialGameFee <= MAX_GAME_FEE, "fee>cap");
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEV_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);
        gameFee = initialGameFee;
    }

    // ===== Views =====
    function getGameStatus(uint256 gameId) public view returns (GameStatus) {
        Game storage g = games[gameId];
        if (g.creator == address(0)) return GameStatus.None;
        if (g.cancelled) return GameStatus.Cancelled;
        if (g.finished) return GameStatus.Finished;
        if (g.started)  return GameStatus.Started;
        return GameStatus.Lobby;
    }

    function getPlayers(uint256 gameId) external view returns (address[] memory) {
        return games[gameId].players;
    }

    function getTotals(address player) external view returns (uint64 score, uint32 gamesPlayed) {
        Totals memory t = totals[player];
        return (t.score, t.gamesPlayed);
    }

    function getGameMeta(uint256 gameId)
        external view
        returns (
            address creator,
            bytes32 inviteCodeHash,
            uint8   maxPlayers,
            bool    usePrize,
            uint64  createdAt,
            uint64  expiryTs,
            uint256 prizeAmount,
            uint256 feeSnapshot,
            bool    started,
            bool    finished,
            bool    cancelled
        )
    {
        Game storage g = games[gameId];
        creator        = g.creator;
        inviteCodeHash = g.inviteCodeHash;
        maxPlayers     = g.maxPlayers;
        usePrize       = g.usePrize;
        createdAt      = g.createdAt;
        expiryTs       = g.expiryTs;
        prizeAmount    = g.prizeAmount;
        feeSnapshot    = g.feeSnapshot;
        started        = g.started;
        finished       = g.finished;
        cancelled      = g.cancelled;
    }

    function rejoinInfo(address player)
        external view
        returns (bool canReconnect, uint256 gameId, uint8 status, uint64 lobbyExpiresAt)
    {
        gameId = activeGameOf[player];
        if (gameId == 0) return (false, 0, 0, 0);
        GameStatus st = getGameStatus(gameId);
        if (st == GameStatus.Cancelled || st == GameStatus.Finished) return (false, 0, 0, 0);
        canReconnect   = true;
        status         = uint8(st);
        lobbyExpiresAt = games[gameId].expiryTs;
    }

    function canJoinByCode(bytes32 inviteCodeHash, address player)
        external view
        returns (bool ok, uint256 gameId, string memory reason)
    {
        gameId = codeToGameId[inviteCodeHash];
        if (gameId == 0) return (false, 0, "unknown code");
        Game storage g = games[gameId];
        if (g.cancelled || g.finished) return (false, gameId, "closed");
        if (g.started)                 return (false, gameId, "started");
        if (block.timestamp >= g.expiryTs) return (false, gameId, "expired");
        if (g.isPlayer[player])            return (false, gameId, "already joined");
        if (g.players.length >= g.maxPlayers) return (false, gameId, "full");
        return (true, gameId, "");
    }

    // ===== Admin =====
    function setGameFee(uint256 newFee) external onlyRole(DEV_ROLE) {
        require(newFee <= MAX_GAME_FEE, "fee>cap");
        uint256 old = gameFee;
        gameFee = newFee;
        emit GameFeeUpdated(old, newFee, block.timestamp);
    }

    function setGlobalRelayer(address newRelayer) external onlyRole(DEV_ROLE) {
        address old = globalRelayer;
        globalRelayer = newRelayer;
        emit RelayerUpdated(old, newRelayer);
    }

    function setLimits(
        uint8 _minMaxPlayers,
        uint8 _maxMaxPlayers,
        uint32 _minLobbyExpiry,
        uint32 _maxLobbyExpiry,
        uint8 _minPlayersToStart
    ) external onlyRole(DEV_ROLE) {
        require(_minMaxPlayers >= 2 && _minMaxPlayers <= _maxMaxPlayers, "bad players range");
        require(_maxMaxPlayers <= 32, "too many players");
        require(_minLobbyExpiry >= 1 minutes && _minLobbyExpiry <= _maxLobbyExpiry, "bad expiry range");
        require(_maxLobbyExpiry <= 2 hours, "expiry too high");
        require(_minPlayersToStart >= 2 && _minPlayersToStart <= _maxMaxPlayers, "bad start threshold");
        minMaxPlayers = _minMaxPlayers;
        maxMaxPlayers = _maxMaxPlayers;
        minLobbyExpiry = _minLobbyExpiry;
        maxLobbyExpiry = _maxLobbyExpiry;
        minPlayersToStart = _minPlayersToStart;
        emit LimitsUpdated(minMaxPlayers, maxMaxPlayers, minLobbyExpiry, maxLobbyExpiry, minPlayersToStart);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) { _pause(); }
    function unpause() external onlyRole(GUARDIAN_ROLE) { _unpause(); }

    function withdrawTreasury(address payable to, uint256 amount) external onlyRole(DEV_ROLE) nonReentrant {
        require(amount <= feePot, "exceeds treasury");
        feePot -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit TreasuryWithdrawn(to, amount);
    }

    // Leaderboard config
    function setLeaderboard(address addr, bool enabled) external onlyRole(DEV_ROLE) {
        leaderboard = addr;
        leaderboardEnabled = enabled;
        emit LeaderboardSet(addr, enabled);
    }

    // ===== Identity (Games-ID) =====
    function adminSetIdentity(uint256 gameId, address embedded, address gamesID)
        external onlyRole(DEV_ROLE)
    {
        require(embedded != address(0) && gamesID != address(0), "bad");
        identityOf[gameId][embedded] = gamesID;
        emit IdentityLinked(gameId, embedded, gamesID);
    }

    // ===== Create / Join (lobby) =====
    function createGame(
        bytes32 inviteCodeHash,
        uint8   maxPlayers,
        uint32  lobbyExpirySeconds,
        bool    usePrize,
        uint256 prizeAmount
    ) public payable whenNotPaused returns (uint256 gameId) {
        require(inviteCodeHash != bytes32(0), "bad code");
        require(codeToGameId[inviteCodeHash] == 0, "code in use");
        require(maxPlayers >= minMaxPlayers && maxPlayers <= maxMaxPlayers, "bad maxPlayers");
        require(lobbyExpirySeconds >= minLobbyExpiry && lobbyExpirySeconds <= maxLobbyExpiry, "bad expiry");

        uint256 requiredValue = gameFee + (usePrize ? prizeAmount : 0);
        require(msg.value == requiredValue, "bad msg.value");

        gameId = ++gameCount;
        Game storage g = games[gameId];
        g.creator        = msg.sender;
        g.inviteCodeHash = inviteCodeHash;
        g.maxPlayers     = maxPlayers;
        g.usePrize       = usePrize;
        g.createdAt      = uint64(block.timestamp);
        g.expiryTs       = uint64(block.timestamp + lobbyExpirySeconds);
        g.prizeAmount    = prizeAmount;
        g.feeSnapshot    = gameFee;

        feePot += gameFee;
        if (usePrize && prizeAmount > 0) reservedPrize += prizeAmount;

        codeToGameId[inviteCodeHash] = gameId;

        // auto-join creator
        g.isPlayer[msg.sender] = true;
        g.players.push(msg.sender);
        activeGameOf[msg.sender] = gameId;
        emit PlayerJoined(gameId, msg.sender, g.players.length);

        emit GameCreated(gameId, inviteCodeHash, msg.sender, usePrize, prizeAmount, gameFee);
        emit GameFeePaid(gameId, msg.sender, gameFee);
    }

    /// NEW: create + link identity (one tx)
    function createGameWithIdentity(
        bytes32 inviteCodeHash,
        uint8   maxPlayers,
        uint32  lobbyExpirySeconds,
        bool    usePrize,
        uint256 prizeAmount,
        address gamesID
    ) external payable whenNotPaused returns (uint256 gameId) {
        gameId = createGame(inviteCodeHash, maxPlayers, lobbyExpirySeconds, usePrize, prizeAmount);
        if (gamesID != address(0)) {
            address existing = identityOf[gameId][msg.sender];
            if (existing == address(0)) {
                identityOf[gameId][msg.sender] = gamesID;
                emit IdentityLinked(gameId, msg.sender, gamesID);
            } else {
                require(existing == gamesID, "identity already set");
            }
        }
    }

    function joinGameByCode(bytes32 inviteCodeHash) external whenNotPaused {
        uint256 gameId = codeToGameId[inviteCodeHash];
        require(gameId != 0, "unknown code");
        joinGame(gameId);
    }

    /// NEW: join-by-code + link identity (one tx)
    function joinGameByCodeWithIdentity(bytes32 inviteCodeHash, address gamesID) external whenNotPaused {
        uint256 gameId = codeToGameId[inviteCodeHash];
        require(gameId != 0, "unknown code");
        joinWithIdentity(gameId, gamesID);
    }

    function joinGame(uint256 gameId) public whenNotPaused {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(!g.cancelled && !g.finished, "closed");
        require(!g.started, "started");
        require(block.timestamp < g.expiryTs, "lobby expired");
        require(!g.isPlayer[msg.sender], "already joined");
        require(g.players.length < g.maxPlayers, "full");

        g.isPlayer[msg.sender] = true;
        g.players.push(msg.sender);
        activeGameOf[msg.sender] = gameId;

        emit PlayerJoined(gameId, msg.sender, g.players.length);
        _maybeAutostart(g, gameId);
    }

    /// NEW: join + link identity (one tx). Auto-start if full.
    function joinWithIdentity(uint256 gameId, address gamesID) public payable whenNotPaused {
        _joinAs(gameId, msg.sender);

        if (gamesID != address(0)) {
            address existing = identityOf[gameId][msg.sender];
            if (existing == address(0)) {
                identityOf[gameId][msg.sender] = gamesID;
                emit IdentityLinked(gameId, msg.sender, gamesID);
            } else {
                require(existing == gamesID, "identity already set");
            }
        }

        Game storage g = games[gameId];
        _maybeAutostart(g, gameId);
    }

    /// NEW: convenience — if not joined, join; then link identity if missing.
    function joinOrLink(uint256 gameId, address gamesID) external whenNotPaused {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");

        if (!g.isPlayer[msg.sender]) {
            _joinAs(gameId, msg.sender);
            _maybeAutostart(g, gameId);
        }
        if (gamesID != address(0)) {
            address existing = identityOf[gameId][msg.sender];
            if (existing == address(0)) {
                identityOf[gameId][msg.sender] = gamesID;
                emit IdentityLinked(gameId, msg.sender, gamesID);
            } else {
                require(existing == gamesID, "identity already set");
            }
        }
    }

    function createGameWithSetup(
        bytes32 inviteCodeHash,
        uint8   maxPlayers,
        uint32  lobbyExpirySeconds,
        bool    usePrize,
        uint256 prizeAmount,
        address gamesID,
        OneTxSetup calldata s
    ) external payable whenNotPaused returns (uint256 gameId) {
        gameId = createGame(inviteCodeHash, maxPlayers, lobbyExpirySeconds, usePrize, prizeAmount);

        // Link Games-ID for creator (same semantics as your setIdentityForThisGame)
        if (gamesID != address(0)) {
            address existing = identityOf[gameId][msg.sender];
            if (existing == address(0)) {
                identityOf[gameId][msg.sender] = gamesID;
                emit IdentityLinked(gameId, msg.sender, gamesID);
            } else {
                require(existing == gamesID, "identity already set");
            }
        }

        // Consent + delegate to current global relayer (no signature needed; caller is player)
        if (globalRelayer != address(0)) {
            relayerConsent[gameId][msg.sender] = true;
            delegate[gameId][msg.sender] = globalRelayer;
            delegateExpiry[gameId][msg.sender] = s.delegateExpiry;
            emit DelegateSet(gameId, msg.sender, globalRelayer, s.delegateExpiry);
        }
    }

    function joinWithSetup(
        uint256 gameId,
        address gamesID,
        OneTxSetup calldata s
    ) external whenNotPaused {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(!g.cancelled && !g.finished, "closed");
        require(!g.started, "started");

        if (!g.isPlayer[msg.sender]) {
            _joinAs(gameId, msg.sender); // emits PlayerJoined
        }

        if (gamesID != address(0)) {
            address existing = identityOf[gameId][msg.sender];
            if (existing == address(0)) {
                identityOf[gameId][msg.sender] = gamesID;
                emit IdentityLinked(gameId, msg.sender, gamesID);
            } else {
                require(existing == gamesID, "identity already set");
            }
        }

        if (globalRelayer != address(0)) {
            relayerConsent[gameId][msg.sender] = true;
            delegate[gameId][msg.sender] = globalRelayer;
            delegateExpiry[gameId][msg.sender] = s.delegateExpiry;
            emit DelegateSet(gameId, msg.sender, globalRelayer, s.delegateExpiry);
        }

        _maybeAutostart(g, gameId);
    }

    function forceStart(uint256 gameId) external whenNotPaused {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(!g.cancelled && !g.finished, "closed");
        require(!g.started, "started");
        require(msg.sender == g.creator, "only creator");
        require(g.players.length >= minPlayersToStart, "need players");
        _startGame(g, gameId);
    }

    function tickLobby(uint256 gameId) external whenNotPaused {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(!g.cancelled && !g.finished && !g.started, "not lobby");
        require(block.timestamp >= g.expiryTs, "not expired");

        if (g.players.length < minPlayersToStart) {
            _cancelLobby(g, gameId, "EXPIRED_TOO_FEW");
        } else {
            _startGame(g, gameId);
        }
    }

    function _maybeAutostart(Game storage g, uint256 gameId) internal {
        if (g.started || g.finished || g.cancelled) return;
        if (g.players.length >= minPlayersToStart && g.players.length == g.maxPlayers) {
            g.started = true;
            emit GameStarted(gameId, uint64(block.timestamp));
        }
    }

    function _removePlayer(Game storage g, address p) internal {
        if (!g.isPlayer[p]) return;
        g.isPlayer[p] = false;
        uint256 L = g.players.length;
        for (uint256 i = 0; i < L; i++) {
            if (g.players[i] == p) {
                if (i != L - 1) g.players[i] = g.players[L - 1];
                g.players.pop();
                break;
            }
        }
    }

    function _startGame(Game storage g, uint256 gameId) internal {
        g.started = true;
        emit GameStarted(gameId, uint64(block.timestamp));
    }

    function _cancelLobby(Game storage g, uint256 gameId, bytes32 reason) internal {
        g.cancelled = true;
        if (codeToGameId[g.inviteCodeHash] == gameId) delete codeToGameId[g.inviteCodeHash];
        if (g.usePrize && g.prizeAmount > 0) {
            reservedPrize -= g.prizeAmount;
            (bool ok, ) = payable(g.creator).call{value: g.prizeAmount}("");
            require(ok, "refund failed");
        }
        for (uint256 i = 0; i < g.players.length; i++) {
            address p = g.players[i];
            if (activeGameOf[p] == gameId) activeGameOf[p] = 0;
        }
        emit GameCancelled(gameId, reason);
        emit GameEnded(gameId, GameStatus.Cancelled, uint64(block.timestamp));
    }

    function leaveLobby(uint256 gameId) external whenNotPaused {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(!g.cancelled && !g.finished && !g.started, "not lobby");
        require(g.isPlayer[msg.sender], "not joined");

        if (msg.sender == g.creator) {
            _cancelLobby(g, gameId, "CREATOR_LEFT");
            return;
        }
        _removePlayer(g, msg.sender);
        if (activeGameOf[msg.sender] == gameId) activeGameOf[msg.sender] = 0;
        emit PlayerLeft(gameId, msg.sender, g.players.length);
    }

    // ===== Finalize (as in your v3) =====
    struct FinalizePayload {
        uint256 gameId;
        address[] players;
        uint32[]  scores;
        address[] winners;
        uint32    roundCount;
        uint256   nonce;
        uint256   deadline;
        bytes32   roundsHash;
    }

    struct OneTxSetup {
        uint64 delegateExpiry; // 0 = no expiry
    }

    struct JoinTicket {
        address player;
        uint256 gameId;
        bytes32 inviteCodeHash;
        uint256 nonce;
        uint256 deadline;
        bool    ackSuddenDeath;
        bool    ackAutoPick;
        bytes   signature;
    }

    function finalizeGame(
        FinalizePayload calldata p,
        bytes calldata sigJudge,
        bytes[] calldata sigPlayers,
        JoinTicket[] calldata tickets
    ) external whenNotPaused nonReentrant {
        Game storage g = games[p.gameId];
        require(g.creator != address(0), "bad game");
        require(g.started && !g.finished && !g.cancelled, "not active");
        require(p.players.length == p.scores.length, "LEN_MISMATCH");
        require(p.players.length == g.players.length, "PLAYERS_MISMATCH");
        require(p.players.length == sigPlayers.length, "SIGS_MISMATCH");
        require(p.players.length == tickets.length, "TICKETS_MISMATCH");
        require(p.deadline == 0 || block.timestamp <= p.deadline, "expired payload");
        require(p.nonce == finalizeNonce[p.gameId], "bad nonce");
        require(p.winners.length >= 1, "no winners");

        for (uint256 i = 0; i < p.players.length; i++) require(g.isPlayer[p.players[i]], "unknown player");
        for (uint256 w = 0; w < p.winners.length; w++) require(g.isPlayer[p.winners[w]], "winner !player");

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    FINALIZATION_TYPEHASH,
                    p.gameId,
                    keccak256(abi.encodePacked(p.players)),
                    keccak256(abi.encodePacked(p.scores)),
                    keccak256(abi.encodePacked(p.winners)),
                    p.roundCount,
                    p.nonce,
                    p.deadline,
                    p.roundsHash
                )
            )
        );

        address judge = ECDSA.recover(digest, sigJudge);
        require(g.isPlayer[judge], "bad judge sig");

        uint256 n = p.players.length;
        uint256 threshold = (2 * n + 2) / 3; // ceil(2/3*n)
        uint256 okCount = 0;
        for (uint256 i = 0; i < n; i++) {
            address expected = p.players[i];
            address signer = ECDSA.recover(digest, sigPlayers[i]);
            require(signer == expected, "sig!=player");
            if (signer != address(0)) okCount++;
        }
        require(okCount >= threshold, "not enough sigs");

        for (uint256 i = 0; i < n; i++) {
            JoinTicket calldata t = tickets[i];
            require(t.player == p.players[i], "ticket!=player");
            require(t.gameId == p.gameId, "ticket gameId");
            require(t.inviteCodeHash == g.inviteCodeHash, "ticket code");
            require(t.deadline == 0 || block.timestamp <= t.deadline, "ticket expired");
            bytes32 tDigest = _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        JOIN_TICKET_TYPEHASH,
                        t.player, t.gameId, t.inviteCodeHash, t.nonce, t.deadline, t.ackSuddenDeath, t.ackAutoPick
                    )
                )
            );
            address tSigner = ECDSA.recover(tDigest, t.signature);
            require(tSigner == t.player, "bad ticket sig");
        }

        // settle
        g.finished = true;
        finalizeNonce[p.gameId] += 1;
        if (codeToGameId[g.inviteCodeHash] == p.gameId) delete codeToGameId[g.inviteCodeHash];

        for (uint256 i = 0; i < n; i++) {
            address pl = p.players[i];
            totals[pl].score += uint64(p.scores[i]);
            totals[pl].gamesPlayed += 1;
            if (activeGameOf[pl] == p.gameId) activeGameOf[pl] = 0;
        }

        if (g.usePrize && g.prizeAmount > 0) {
            reservedPrize -= g.prizeAmount;
            uint256 each = g.prizeAmount / p.winners.length;
            uint256 rem  = g.prizeAmount - (each * p.winners.length);
            for (uint256 i = 0; i < p.winners.length; i++) {
                uint256 amt = each + (i == 0 ? rem : 0);
                (bool ok, ) = payable(p.winners[i]).call{value: amt}("");
                require(ok, "prize pay failed");
                emit PrizePaid(p.gameId, p.winners[i], amt);
            }
        }

        // record for leaderboard push
        finalPlayersCount[p.gameId] = uint16(n);
        for (uint256 i = 0; i < n; i++) {
            address pl = p.players[i];
            finalRecorded[p.gameId][pl] = true;
            finalScore[p.gameId][pl]    = p.scores[i];
        }
        finalHash[p.gameId] = keccak256(abi.encode(p.players, p.scores));

        emit FinalScores(p.gameId, p.players, p.scores, p.winners);
        emit GameEnded(p.gameId, GameStatus.Finished, uint64(block.timestamp));
    }

/// Finalize by relayer/delegate (no player signatures).
/// Requirements:
/// - game started, not finished/cancelled
/// - caller is SUBMITTER_ROLE or current globalRelayer
/// - if caller is globalRelayer: every player must have relayerConsent[gid][player]==true,
///   delegate[gid][player]==globalRelayer, and delegateExpiry not expired
function finalizeByDelegate(FinalizePayload calldata p)
    external
    whenNotPaused
    nonReentrant
{
    Game storage g = games[p.gameId];
    require(g.creator != address(0), "bad game");
    require(g.started && !g.finished && !g.cancelled, "not active");

    uint256 n = p.players.length;
    require(n == p.scores.length && n == g.players.length, "LEN_MISMATCH");
    require(p.winners.length >= 1, "no winners");
    require(p.deadline == 0 || block.timestamp <= p.deadline, "expired payload");
    require(p.nonce == finalizeNonce[p.gameId], "bad nonce");

    // players must exactly match lobby order (avoids misalignment)
    for (uint256 i = 0; i < n; i++) {
        require(g.players[i] == p.players[i], "players order");
        require(g.isPlayer[p.players[i]], "unknown player");
    }
    // winners must be players
    for (uint256 w = 0; w < p.winners.length; w++) {
        require(g.isPlayer[p.winners[w]], "winner !player");
    }

    // Authorization
    bool isSubmitter = hasRole(SUBMITTER_ROLE, msg.sender);
    bool isRelayer   = (msg.sender == globalRelayer) && (globalRelayer != address(0));
    require(isSubmitter || isRelayer, "not authorized");

    // If caller is the globalRelayer, enforce per-player consent + valid delegate
    if (isRelayer) {
        for (uint256 i = 0; i < n; i++) {
            address pl = p.players[i];
            require(relayerConsent[p.gameId][pl], "no consent");
            require(delegate[p.gameId][pl] == globalRelayer, "bad delegate");
            uint64 exp = delegateExpiry[p.gameId][pl];
            require(exp == 0 || block.timestamp <= exp, "delegate expired");
        }
    }

    // ---- settle (same as finalizeGame) ----
    g.finished = true;
    finalizeNonce[p.gameId] += 1;
    if (codeToGameId[g.inviteCodeHash] == p.gameId) {
        delete codeToGameId[g.inviteCodeHash];
    }

    for (uint256 i = 0; i < n; i++) {
        address pl = p.players[i];
        totals[pl].score       += uint64(p.scores[i]);
        totals[pl].gamesPlayed += 1;
        if (activeGameOf[pl] == p.gameId) activeGameOf[pl] = 0;
    }

    if (g.usePrize && g.prizeAmount > 0) {
        reservedPrize -= g.prizeAmount;
        uint256 each = g.prizeAmount / p.winners.length;
        uint256 rem  = g.prizeAmount - (each * p.winners.length);
        for (uint256 i = 0; i < p.winners.length; i++) {
            uint256 amt = each + (i == 0 ? rem : 0);
            (bool ok, ) = payable(p.winners[i]).call{value: amt}("");
            require(ok, "prize pay failed");
            emit PrizePaid(p.gameId, p.winners[i], amt);
        }
    }

    // record for leaderboard push
    finalPlayersCount[p.gameId] = uint16(n);
    for (uint256 i = 0; i < n; i++) {
        address pl = p.players[i];
        finalRecorded[p.gameId][pl] = true;
        finalScore[p.gameId][pl]    = p.scores[i];
    }
    finalHash[p.gameId] = keccak256(abi.encode(p.players, p.scores));

    emit FinalScores(p.gameId, p.players, p.scores, p.winners);
    emit GameEnded(p.gameId, GameStatus.Finished, uint64(block.timestamp));
}

    // ===== Delegate (unchanged API; auto-start wired) =====
    struct DelegateApproval {
        address player;
        address delegate;
        uint256 expiresAt;
        bytes   signature;
    }
    mapping(uint256 => mapping(address => address)) public delegate;
    mapping(uint256 => mapping(address => uint64))  public delegateExpiry;
    event DelegateSet(uint256 indexed gameId, address indexed player, address indexed delegate, uint64 expiresAt);

    function delegateOf(uint256 gameId, address player) external view returns (address, uint64) {
        return (delegate[gameId][player], delegateExpiry[gameId][player]);
    }

    function joinGameWithApproval(uint256 gameId, DelegateApproval calldata a) external whenNotPaused {
        require(a.delegate == msg.sender, "not delegate");
        require(a.expiresAt == 0 || block.timestamp <= a.expiresAt, "approval expired");

        // EIP-712 verify: player must have signed this approval for this game
        bytes32 dDigest = _hashTypedDataV4(
            keccak256(abi.encode(
                DELEGATE_APPROVAL_TYPEHASH,
                a.player,
                a.delegate,
                gameId,
                a.expiresAt
            ))
        );
        address signer = ECDSA.recover(dDigest, a.signature);
        require(signer == a.player, "bad delegate sig");

        delegate[gameId][a.player] = a.delegate;
        delegateExpiry[gameId][a.player] = uint64(a.expiresAt);
        _joinAs(gameId, a.player);
        emit DelegateSet(gameId, a.player, a.delegate, uint64(a.expiresAt));

        Game storage g = games[gameId];
        _maybeAutostart(g, gameId);
    }

    function joinGameByCodeWithApproval(bytes32 inviteCodeHash, DelegateApproval calldata a) external whenNotPaused {
        require(a.delegate == msg.sender, "not delegate");
        require(a.expiresAt == 0 || block.timestamp <= a.expiresAt, "approval expired");

        uint256 gameId = codeToGameId[inviteCodeHash];
        require(gameId != 0, "unknown code");

        // EIP-712 verify: player must have signed this approval for this game
        bytes32 dDigest = _hashTypedDataV4(
            keccak256(abi.encode(
                DELEGATE_APPROVAL_TYPEHASH,
                a.player,
                a.delegate,
                gameId,
                a.expiresAt
            ))
        );
        address signer = ECDSA.recover(dDigest, a.signature);
        require(signer == a.player, "bad delegate sig");

        delegate[gameId][a.player] = a.delegate;
        delegateExpiry[gameId][a.player] = uint64(a.expiresAt);
        _joinAs(gameId, a.player);
        emit DelegateSet(gameId, a.player, a.delegate, uint64(a.expiresAt));

        Game storage g = games[gameId];
        _maybeAutostart(g, gameId);
    }

    function _joinAs(uint256 gameId, address who) internal {
        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(!g.cancelled && !g.finished, "closed");
        require(!g.started, "started");
        require(block.timestamp < g.expiryTs, "lobby expired");
        require(!g.isPlayer[who], "already joined");
        require(g.players.length < g.maxPlayers, "full");
        g.isPlayer[who] = true;
        g.players.push(who);
        activeGameOf[who] = gameId;
        emit PlayerJoined(gameId, who, g.players.length);
    }

    // ===== Leaderboard external push (unchanged) =====
    function identityOrEmbedded(uint256 gameId, address embedded) public view returns (address) {
        address id = identityOf[gameId][embedded];
        return id == address(0) ? embedded : id;
    }

    function externalPushScores(
        uint256 gameId,
        address[] calldata players,
        uint32[]  calldata scores,
        bytes32   requestId
    ) external {
        // Must be globally enabled and have a leaderboard target
        require(leaderboardEnabled && leaderboard != address(0), "LB disabled");

        Game storage g = games[gameId];
        require(g.creator != address(0), "bad game");
        require(g.finished && !g.cancelled, "not finished");

        // Auth: either global SUBMITTER_ROLE or the current global relayer
        bool isAuthorized =
            hasRole(SUBMITTER_ROLE, msg.sender) ||
            (msg.sender == globalRelayer && globalRelayer != address(0));
        require(isAuthorized, "not authorized to push");

        require(players.length == scores.length && players.length > 0, "LEN");
        require(!seenExternalPush[requestId], "duplicate");
        seenExternalPush[requestId] = true;

        for (uint256 i = 0; i < players.length; i++) {
            address p = players[i];
            require(finalRecorded[gameId][p], "not in final");
            if (pushedScore[gameId][p]) continue;

            // If caller is relayer, per-player consent must be present
            if (msg.sender == globalRelayer) {
                require(relayerConsent[gameId][p], "player no consent");
            }

            uint32 s = scores[i];

            // Resolve identity for leaderboard (Games-ID if present)
            address who = identityOf[gameId][p];
            if (who == address(0)) who = p;

            try ILeaderboard(leaderboard).updatePlayerData(who, s, 1) {
                pushedScore[gameId][p] = true;
                pushedPlayersCount[gameId] += 1;
                emit LeaderboardPushed(gameId, p);
            } catch (bytes memory reason) {
                emit LeaderboardPushFailed(gameId, p, reason);
            }
        }

        if (pushedPlayersCount[gameId] == finalPlayersCount[gameId] && !scoresPushed[gameId]) {
            scoresPushed[gameId] = true;
            emit LeaderboardPushOk(gameId);
        }
    }

    // ===== Fallback =====
    receive() external payable {}
}
