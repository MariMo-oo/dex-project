import { network } from "hardhat";
import { getCreateAddress } from "ethers";

// Hardhat v3: ethers comes from network.connect(), not hre.ethers
const { ethers } = await network.connect();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Token      = await ethers.getContractFactory("Token");
  const DEX        = await ethers.getContractFactory("DEX");
  const LPToken    = await ethers.getContractFactory("LPToken");
  const Arbitrage  = await ethers.getContractFactory("Arbitrage");

  // ── Tokens ──────────────────────────────────────────────────────
  const tokenA = await Token.deploy("Token A", "TKA", 1_000_000);
  const tokenB = await Token.deploy("Token B", "TKB", 1_000_000);
  await tokenA.waitForDeployment();
  await tokenB.waitForDeployment();
  const addrA = await tokenA.getAddress();
  const addrB = await tokenB.getAddress();
  console.log("TokenA:", addrA);
  console.log("TokenB:", addrB);

  // ── DEX1 + LPToken1 (nonce prediction for circular dependency) ──
  const nonce1         = await ethers.provider.getTransactionCount(deployer.address);
  const predictedDex1  = getCreateAddress({ from: deployer.address, nonce: nonce1 });
  const predictedLpt1  = getCreateAddress({ from: deployer.address, nonce: nonce1 + 1 });

  const dex1 = await DEX.deploy(addrA, addrB, predictedLpt1);
  const lpt1 = await LPToken.deploy(predictedDex1);
  await dex1.waitForDeployment();
  await lpt1.waitForDeployment();
  const addrDex1 = await dex1.getAddress();
  const addrLpt1 = await lpt1.getAddress();
  console.log("DEX1:    ", addrDex1);
  console.log("LPToken1:", addrLpt1);

  // ── DEX2 + LPToken2 ─────────────────────────────────────────────
  const nonce2         = await ethers.provider.getTransactionCount(deployer.address);
  const predictedDex2  = getCreateAddress({ from: deployer.address, nonce: nonce2 });
  const predictedLpt2  = getCreateAddress({ from: deployer.address, nonce: nonce2 + 1 });

  const dex2 = await DEX.deploy(addrA, addrB, predictedLpt2);
  const lpt2 = await LPToken.deploy(predictedDex2);
  await dex2.waitForDeployment();
  await lpt2.waitForDeployment();
  const addrDex2 = await dex2.getAddress();
  const addrLpt2 = await lpt2.getAddress();
  console.log("DEX2:    ", addrDex2);
  console.log("LPToken2:", addrLpt2);

  // ── Arbitrage ────────────────────────────────────────────────────
  const arbitrage = await Arbitrage.deploy(
    addrDex1, addrDex2, addrA, addrB,
    ethers.parseUnits("0.01", 18)
  );
  await arbitrage.waitForDeployment();
  const addrArb = await arbitrage.getAddress();
  console.log("Arbitrage:", addrArb);

  console.log("\n── Deployed Addresses ──────────────────────────────");
  console.log(`TokenA    = ${addrA}`);
  console.log(`TokenB    = ${addrB}`);
  console.log(`DEX1      = ${addrDex1}`);
  console.log(`LPToken1  = ${addrLpt1}`);
  console.log(`DEX2      = ${addrDex2}`);
  console.log(`LPToken2  = ${addrLpt2}`);
  console.log(`Arbitrage = ${addrArb}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

