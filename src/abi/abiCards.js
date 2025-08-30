export default [
  // ───── Events (Prompts) ─────.
  {
    "type": "event",
    "name": "PromptAdded",
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "uint256" },
      { "indexed": false, "name": "text", "type": "string" },
      { "indexed": false, "name": "imageRef", "type": "uint32" }
    ]
  },
  {
    "type": "event",
    "name": "PromptEdited",
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "uint256" },
      { "indexed": false, "name": "rev", "type": "uint16" },
      { "indexed": false, "name": "text", "type": "string" },
      { "indexed": false, "name": "imageRef", "type": "uint32" }
    ]
  },
  {
    "type": "event",
    "name": "PromptActiveSet",
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "uint256" },
      { "indexed": false, "name": "active", "type": "bool" }
    ]
  },

  // ───── Events (Answers) ─────
  {
    "type": "event",
    "name": "AnswerAdded",
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "uint256" },
      { "indexed": false, "name": "text", "type": "string" },
      { "indexed": false, "name": "imageRef", "type": "uint32" }
    ]
  },
  {
    "type": "event",
    "name": "AnswerEdited",
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "uint256" },
      { "indexed": false, "name": "rev", "type": "uint16" },
      { "indexed": false, "name": "text", "type": "string" },
      { "indexed": false, "name": "imageRef", "type": "uint32" }
    ]
  },
  {
    "type": "event",
    "name": "AnswerActiveSet",
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "uint256" },
      { "indexed": false, "name": "active", "type": "bool" }
    ]
  },

  // ───── Roles (readable constants) ─────
  { "type": "function", "stateMutability": "view", "name": "DEV_ROLE", "inputs": [], "outputs": [{ "type": "bytes32" }] },
  { "type": "function", "stateMutability": "view", "name": "MOD_ROLE", "inputs": [], "outputs": [{ "type": "bytes32" }] },

  // ───── Public vars (counts) ─────
  { "type": "function", "stateMutability": "view", "name": "promptCount", "inputs": [], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "stateMutability": "view", "name": "answerCount", "inputs": [], "outputs": [{ "type": "uint256" }] },

  // ───── Admin (pause) ─────
  { "type": "function", "stateMutability": "nonpayable", "name": "pause", "inputs": [], "outputs": [] },
  { "type": "function", "stateMutability": "nonpayable", "name": "unpause", "inputs": [], "outputs": [] },

  // ───── Add (batch) ─────
  {
    "type": "function",
    "stateMutability": "nonpayable",
    "name": "addPromptBatch",
    "inputs": [
      { "name": "texts", "type": "string[]" },
      { "name": "imageRefs", "type": "uint32[]" }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "stateMutability": "nonpayable",
    "name": "addAnswerBatch",
    "inputs": [
      { "name": "texts", "type": "string[]" },
      { "name": "imageRefs", "type": "uint32[]" }
    ],
    "outputs": []
  },

  // ───── Edit (new revision) ─────
  {
    "type": "function",
    "stateMutability": "nonpayable",
    "name": "editPrompt",
    "inputs": [
      { "name": "id", "type": "uint256" },
      { "name": "newText", "type": "string" },
      { "name": "newImageRef", "type": "uint32" }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "stateMutability": "nonpayable",
    "name": "editAnswer",
    "inputs": [
      { "name": "id", "type": "uint256" },
      { "name": "newText", "type": "string" },
      { "name": "newImageRef", "type": "uint32" }
    ],
    "outputs": []
  },

  // ───── Hide/Unhide ─────
  {
    "type": "function",
    "stateMutability": "nonpayable",
    "name": "setPromptActive",
    "inputs": [
      { "name": "id", "type": "uint256" },
      { "name": "active", "type": "bool" }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "stateMutability": "nonpayable",
    "name": "setAnswerActive",
    "inputs": [
      { "name": "id", "type": "uint256" },
      { "name": "active", "type": "bool" }
    ],
    "outputs": []
  },

  // ───── Views (single) ─────
  {
    "type": "function",
    "stateMutability": "view",
    "name": "getPrompt",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [
      { "type": "bool", "name": "exists" },
      { "type": "bool", "name": "active" },
      { "type": "uint16", "name": "latestRev" },
      { "type": "string", "name": "text" },
      { "type": "uint32", "name": "imageRef" }
    ]
  },
  {
    "type": "function",
    "stateMutability": "view",
    "name": "getAnswer",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [
      { "type": "bool", "name": "exists" },
      { "type": "bool", "name": "active" },
      { "type": "uint16", "name": "latestRev" },
      { "type": "string", "name": "text" },
      { "type": "uint32", "name": "imageRef" }
    ]
  },

  // ───── Views (pagination) ─────
  {
    "type": "function",
    "stateMutability": "view",
    "name": "pagePrompts",
    "inputs": [
      { "name": "startId", "type": "uint256" },
      { "name": "maxItems", "type": "uint256" },
      { "name": "onlyActive", "type": "bool" }
    ],
    "outputs": [
      { "type": "uint256[]", "name": "ids" },
      { "type": "string[]",  "name": "texts" },
      { "type": "uint32[]",  "name": "imageRefs" },
      { "type": "bool[]",    "name": "actives" }
    ]
  },
  {
    "type": "function",
    "stateMutability": "view",
    "name": "pageAnswers",
    "inputs": [
      { "name": "startId", "type": "uint256" },
      { "name": "maxItems", "type": "uint256" },
      { "name": "onlyActive", "type": "bool" }
    ],
    "outputs": [
      { "type": "uint256[]", "name": "ids" },
      { "type": "string[]",  "name": "texts" },
      { "type": "uint32[]",  "name": "imageRefs" },
      { "type": "bool[]",    "name": "actives" }
    ]
  }
]
