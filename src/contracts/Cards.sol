// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface ICardsV1 {
    // Heads-up: We keep the interface minimal (no struct types here)
    function promptCount() external view returns (uint256);
    function getPrompt(uint256 id) external view returns (bool exists, bool active, uint16 latestRev, string memory text, uint32 imageRef);
    function pagePrompts(uint256 startId, uint256 maxItems, bool onlyActive) external view returns (uint256[] memory ids, string[] memory texts, uint32[] memory imageRefs, bool[] memory actives);

    function answerCount() external view returns (uint256);
    function getAnswer(uint256 id) external view returns (bool exists, bool active, uint16 latestRev, string memory text, uint32 imageRef);
    function pageAnswers(uint256 startId, uint256 maxItems, bool onlyActive) external view returns (uint256[] memory ids, string[] memory texts, uint32[] memory imageRefs, bool[] memory actives);
}

contract Cards is AccessControl, Pausable, ICardsV1 {
    bytes32 public constant DEV_ROLE = keccak256("DEV_ROLE");
    bytes32 public constant MOD_ROLE = keccak256("MOD_ROLE");

    // ---- Storage ----
    uint256 public override promptCount;
    uint256 public override answerCount;

    struct CardHead { bool exists; bool active; uint16 latestRev; }
    struct CardContent { string text; uint32 imageRef; }

    mapping(uint256 => CardHead) private promptHead;
    mapping(uint256 => mapping(uint16 => CardContent)) private promptRev;

    mapping(uint256 => CardHead) private answerHead;
    mapping(uint256 => mapping(uint16 => CardContent)) private answerRev;

    // ---- Events ----
    event PromptAdded(uint256 indexed id, string text, uint32 imageRef);
    event PromptEdited(uint256 indexed id, uint16 rev, string text, uint32 imageRef);
    event PromptActiveSet(uint256 indexed id, bool active);

    event AnswerAdded(uint256 indexed id, string text, uint32 imageRef);
    event AnswerEdited(uint256 indexed id, uint16 rev, string text, uint32 imageRef);
    event AnswerActiveSet(uint256 indexed id, bool active);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DEV_ROLE, admin);
        _grantRole(MOD_ROLE, admin);
    }

    // ---- Admin ----
    function pause() external onlyRole(DEV_ROLE) { _pause(); }
    function unpause() external onlyRole(DEV_ROLE) { _unpause(); }

    // ---- Add (batch) ----
    function addPromptBatch(string[] calldata texts, uint32[] calldata imageRefs) external onlyRole(MOD_ROLE) whenNotPaused {
        require(texts.length == imageRefs.length, "LEN_MISMATCH");
        for (uint256 i = 0; i < texts.length; i++) {
            _validateText(texts[i]);
            uint256 id = ++promptCount;
            promptHead[id] = CardHead({ exists: true, active: true, latestRev: 1 });
            promptRev[id][1] = CardContent({ text: texts[i], imageRef: imageRefs[i] });
            emit PromptAdded(id, texts[i], imageRefs[i]);
        }
    }

    function addAnswerBatch(string[] calldata texts, uint32[] calldata imageRefs) external onlyRole(MOD_ROLE) whenNotPaused {
        require(texts.length == imageRefs.length, "LEN_MISMATCH");
        for (uint256 i = 0; i < texts.length; i++) {
            _validateText(texts[i]);
            uint256 id = ++answerCount;
            answerHead[id] = CardHead({ exists: true, active: true, latestRev: 1 });
            answerRev[id][1] = CardContent({ text: texts[i], imageRef: imageRefs[i] });
            emit AnswerAdded(id, texts[i], imageRefs[i]);
        }
    }

    // ---- Edit (new revision) ----
    function editPrompt(uint256 id, string calldata newText, uint32 newImageRef) external onlyRole(MOD_ROLE) whenNotPaused {
        require(promptHead[id].exists, "NO_PROMPT");
        _validateText(newText);
        uint16 rev = promptHead[id].latestRev + 1;
        promptHead[id].latestRev = rev;
        promptRev[id][rev] = CardContent({ text: newText, imageRef: newImageRef });
        emit PromptEdited(id, rev, newText, newImageRef);
    }

    function editAnswer(uint256 id, string calldata newText, uint32 newImageRef) external onlyRole(MOD_ROLE) whenNotPaused {
        require(answerHead[id].exists, "NO_ANSWER");
        _validateText(newText);
        uint16 rev = answerHead[id].latestRev + 1;
        answerHead[id].latestRev = rev;
        answerRev[id][rev] = CardContent({ text: newText, imageRef: newImageRef });
        emit AnswerEdited(id, rev, newText, newImageRef);
    }

    // ---- Hide/Unhide ----
    function setPromptActive(uint256 id, bool active) external onlyRole(MOD_ROLE) whenNotPaused {
        require(promptHead[id].exists, "NO_PROMPT");
        promptHead[id].active = active;
        emit PromptActiveSet(id, active);
    }

    function setAnswerActive(uint256 id, bool active) external onlyRole(MOD_ROLE) whenNotPaused {
        require(answerHead[id].exists, "NO_ANSWER");
        answerHead[id].active = active;
        emit AnswerActiveSet(id, active);
    }

    // ---- Views ----
    function getPrompt(uint256 id) public view override returns (bool exists, bool active, uint16 latestRev, string memory text, uint32 imageRef) {
        CardHead memory h = promptHead[id];
        if (!h.exists) return (false, false, 0, "", 0);
        CardContent memory c = promptRev[id][h.latestRev];
        return (true, h.active, h.latestRev, c.text, c.imageRef);
    }

    function getAnswer(uint256 id) public view override returns (bool exists, bool active, uint16 latestRev, string memory text, uint32 imageRef) {
        CardHead memory h = answerHead[id];
        if (!h.exists) return (false, false, 0, "", 0);
        CardContent memory c = answerRev[id][h.latestRev];
        return (true, h.active, h.latestRev, c.text, c.imageRef);
    }

    function pagePrompts(uint256 startId, uint256 maxItems, bool onlyActive)
        external view override
        returns (uint256[] memory ids, string[] memory texts, uint32[] memory imageRefs, bool[] memory actives)
    {
        require(maxItems > 0 && maxItems <= 250, "BAD_LIMIT");
        uint256 cap = promptCount;
        if (startId == 0) startId = 1;

        uint256 collected = 0;
        ids = new uint256[](maxItems);
        texts = new string[](maxItems);
        imageRefs = new uint32[](maxItems);
        actives = new bool[](maxItems);

        for (uint256 id = startId; id <= cap && collected < maxItems; id++) {
            CardHead memory h = promptHead[id];
            if (!h.exists) continue;
            if (onlyActive && !h.active) continue;
            CardContent memory c = promptRev[id][h.latestRev];
            ids[collected] = id;
            texts[collected] = c.text;
            imageRefs[collected] = c.imageRef;
            actives[collected] = h.active;
            collected++;
        }

        assembly { mstore(ids, collected) mstore(texts, collected) mstore(imageRefs, collected) mstore(actives, collected) }
    }

    function pageAnswers(uint256 startId, uint256 maxItems, bool onlyActive)
        external view override
        returns (uint256[] memory ids, string[] memory texts, uint32[] memory imageRefs, bool[] memory actives)
    {
        require(maxItems > 0 && maxItems <= 250, "BAD_LIMIT");
        uint256 cap = answerCount;
        if (startId == 0) startId = 1;

        uint256 collected = 0;
        ids = new uint256[](maxItems);
        texts = new string[](maxItems);
        imageRefs = new uint32[](maxItems);
        actives = new bool[](maxItems);

        for (uint256 id = startId; id <= cap && collected < maxItems; id++) {
            CardHead memory h = answerHead[id];
            if (!h.exists) continue;
            if (onlyActive && !h.active) continue;
            CardContent memory c = answerRev[id][h.latestRev];
            ids[collected] = id;
            texts[collected] = c.text;
            imageRefs[collected] = c.imageRef;
            actives[collected] = h.active;
            collected++;
        }

        assembly { mstore(ids, collected) mstore(texts, collected) mstore(imageRefs, collected) mstore(actives, collected) }
    }

    // ---- Internal validation ----
    function _validateText(string calldata s) internal pure {
        bytes memory b = bytes(s);
        require(b.length > 0 && b.length <= 512, "LEN");
        // Further validation (profanity etc.) should be done off-chain.
    }
}
