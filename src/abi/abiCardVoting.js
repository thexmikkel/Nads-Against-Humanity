// src/abi/abiCardVoting.js
export default [
  // views
  {"inputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"address","name":"who","type":"address"}],"name":"getPromptTally","outputs":[{"internalType":"uint32","name":"up","type":"uint32"},{"internalType":"uint32","name":"down","type":"uint32"},{"internalType":"int32","name":"score","type":"int32"},{"internalType":"int8","name":"myVote","type":"int8"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"address","name":"who","type":"address"}],"name":"getAnswerTally","outputs":[{"internalType":"uint32","name":"up","type":"uint32"},{"internalType":"uint32","name":"down","type":"uint32"},{"internalType":"int32","name":"score","type":"int32"},{"internalType":"int8","name":"myVote","type":"int8"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"votingConsentExpiry","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"globalRelayer","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},

  // direct voting
  {"inputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"int8","name":"v","type":"int8"}],"name":"votePrompt","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"int8","name":"v","type":"int8"}],"name":"voteAnswer","outputs":[],"stateMutability":"nonpayable","type":"function"},

  // gasless consent
  {"inputs":[{"internalType":"address","name":"voter","type":"address"},{"internalType":"address","name":"relayer","type":"address"},{"internalType":"uint64","name":"expiresAt","type":"uint64"},{"internalType":"uint256","name":"nonce","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"bytes","name":"sig","type":"bytes"}],"name":"setVotingConsentBySig","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"revokeVotingConsent","outputs":[],"stateMutability":"nonpayable","type":"function"},

  // relayer voting
  {"inputs":[{"internalType":"address","name":"voter","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"int8","name":"v","type":"int8"}],"name":"votePromptFor","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"address","name":"voter","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"int8","name":"v","type":"int8"}],"name":"voteAnswerFor","outputs":[],"stateMutability":"nonpayable","type":"function"}
]
