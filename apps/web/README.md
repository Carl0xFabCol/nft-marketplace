# SupNFT – Full‑stack Web3 NFT Mint DApp

SupNFT is a full‑stack Web3 decentralized application built to demonstrate practical skills in modern Ethereum development. The project covers the complete NFT lifecycle: minting, burning with ETH refund, wallet connection, contract interaction, and on‑chain state synchronization.

This repository is intended as a **technical showcase** for Web3 / Blockchain developer roles.

---

## 🚀 Live Demo

- **Network:** Sepolia Testnet
- **Contract:** ERC‑721 deployed and verified on Sepolia
- **Wallet:** MetaMask / Injected wallets

---

## 🧠 Project Purpose

The goal of this project is to demonstrate:

- Real‑world smart contract design decisions
- Secure NFT mint & burn flows
- Clean frontend–contract integration
- Professional tooling used in production Web3 stacks

---

## 🧩 Features

### Smart Contract

https://github.com/0xteric/SUP-NFT/blob/main/src/SupNFT.sol

- ERC‑721 NFT implementation using OpenZeppelin
- Public mint with:

  - Max supply
  - Max mint per transaction
  - Fixed mint price

- Burn functionality with automatic ETH refund
- Reentrancy protection
- Events for minting and burning

### Frontend

- Wallet connection (MetaMask)
- Network detection & auto switch (Sepolia)
- Mint UI with:

  - Validation
  - Transaction lifecycle states (waiting signature → pending → success)
  - Transaction hash & Etherscan link

- Burn UI for owned NFTs
- Live contract stats (price, total supply)
- Automatic UI refresh after on‑chain actions

---

## 🛠️ Tech Stack

### Smart Contracts

- **Solidity** ^0.8.x
- **OpenZeppelin** (ERC721, Ownable, ReentrancyGuard)
- **Foundry** (forge, scripts, local testing)

### Frontend

- **Next.js 14+** (App Router)
- **React**
- **TypeScript**
- **wagmi** + **viem**
- **TanStack Query**
- **Tailwind CSS**

### Network

- **Ethereum Sepolia Testnet**

---

## 🔐 Security Considerations

- Reentrancy protection on ETH‑handling functions
- Strict supply limits enforced on‑chain
- ETH refund logic carefully ordered to avoid locked funds
- No privileged minting (fair mint logic)

---

## ⚙️ Local Setup

### Prerequisites

- Node.js 18+
- Foundry

### Install dependencies

```bash
npm install
```

### Run frontend

```bash
npm run dev
```

### Build contracts

```bash
forge build
```

---

## 🧪 Deployment

Contracts are deployed using Foundry scripts:

```bash
forge script script/SupNFT.s.sol:SupNFTScript \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key $PK \
  --broadcast
```

---

## 📌 What This Project Demonstrates

- Full NFT lifecycle management
- Secure ETH flows in smart contracts
- Frontend–contract synchronization
- Modern Web3 developer tooling
- Clean and readable code structure

---

## 📝 License

MIT License
