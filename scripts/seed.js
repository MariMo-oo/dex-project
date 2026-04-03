import { network } from "hardhat";

const { ethers } = await network.connect();

const [owner] = await ethers.getSigners();

const TOKEN_A  = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const TOKEN_B  = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const DEX1     = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

const tokenA = await ethers.getContractAt("Token", TOKEN_A);
const tokenB = await ethers.getContractAt("Token", TOKEN_B);
const dex    = await ethers.getContractAt("DEX",   DEX1);

// Approve DEX to spend tokens
await tokenA.approve(DEX1, ethers.parseUnits("10000", 18));
await tokenB.approve(DEX1, ethers.parseUnits("15000", 18));

// Add initial liquidity (ratio 1 TKA : 1.5 TKB → spot price = 1.5)
await dex.addLiquidity(
  ethers.parseUnits("1000", 18),
  ethers.parseUnits("1500", 18)
);

const [rA, rB] = await dex.getReserves();
console.log("ReserveA:", ethers.formatUnits(rA, 18));
console.log("ReserveB:", ethers.formatUnits(rB, 18));
console.log("Spot price (A/B ×1e18):", ethers.formatUnits(await dex.getSpotPrice(), 18));
console.log("Seed complete ✓");
