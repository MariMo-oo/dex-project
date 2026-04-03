import { expect } from "chai";
import { network } from "hardhat";
import { getCreateAddress } from "ethers"; // ← import utility directly from ethers

describe("DEX Simulation — N=75 transactions", function () {
  this.timeout(120_000);

  // ── Deploy helper: predict DEX address so LPToken can reference it ──────
  async function deployDEXPair(ethers: any, owner: any, addrA: string, addrB: string) {
    const nonce = await ethers.provider.getTransactionCount(owner.address);

    // Predict the address DEX will be deployed at (nonce), and LPToken at (nonce+1)
    const predictedDexAddr = getCreateAddress({ from: owner.address, nonce: nonce });
    const predictedLpAddr  = getCreateAddress({ from: owner.address, nonce: nonce + 1 });

    // Deploy DEX first (it receives the future LPToken address)
    const dex = await ethers.deployContract("DEX", [addrA, addrB, predictedLpAddr]);
    // Deploy LPToken second (it receives the already-deployed DEX address)
    const lp  = await ethers.deployContract("LPToken", [predictedDexAddr]);

    // Sanity check — actual addresses must match predictions
    const actualDexAddr = await dex.getAddress();
    const actualLpAddr  = await lp.getAddress();
    if (actualDexAddr.toLowerCase() !== predictedDexAddr.toLowerCase()) {
      throw new Error(`DEX address mismatch: got ${actualDexAddr}, expected ${predictedDexAddr}`);
    }
    if (actualLpAddr.toLowerCase() !== predictedLpAddr.toLowerCase()) {
      throw new Error(`LPToken address mismatch: got ${actualLpAddr}, expected ${predictedLpAddr}`);
    }

    return { dex, lp, dexAddr: actualDexAddr, lpAddr: actualLpAddr };
  }

  it("runs 75 random transactions and tracks all metrics", async function () {
    const { ethers } = await network.connect();
    const signers = await ethers.getSigners();

    const lps     = signers.slice(0, 5);
    const traders = signers.slice(5, 13);

    const tokenA = await ethers.deployContract("Token", ["Token A", "TKA", 10_000_000]);
    const tokenB = await ethers.deployContract("Token", ["Token B", "TKB", 10_000_000]);
    const addrA  = await tokenA.getAddress();
    const addrB  = await tokenB.getAddress();

    const { dex, dexAddr } = await deployDEXPair(ethers, signers[0], addrA, addrB);

    const SEED = ethers.parseUnits("50000", 18);

    for (const lp of lps) {
      await tokenA.transfer(lp.address, SEED);
      await tokenB.transfer(lp.address, SEED);
      await tokenA.connect(lp).approve(dexAddr, ethers.MaxUint256);
      await tokenB.connect(lp).approve(dexAddr, ethers.MaxUint256);
    }
    for (const tr of traders) {
      await tokenA.transfer(tr.address, SEED);
      await tokenB.transfer(tr.address, SEED);
      await tokenA.connect(tr).approve(dexAddr, ethers.MaxUint256);
      await tokenB.connect(tr).approve(dexAddr, ethers.MaxUint256);
    }

    // Seed initial liquidity
    const initA = ethers.parseUnits("1000", 18);
    const initB = ethers.parseUnits("1500", 18);
    await tokenA.approve(dexAddr, ethers.MaxUint256);
    await tokenB.approve(dexAddr, ethers.MaxUint256);
    await dex.addLiquidity(initA, initB);

    // ── rest of simulation loop unchanged from before ──
    // ... (keep your existing loop and assertions)

    const [rA, rB] = await dex.getReserves();
    expect(rA).to.be.gt(0n);
    expect(rB).to.be.gt(0n);
    expect(rA * rB).to.be.gte(initA * initB);
    console.log("\nSimulation complete ✓");
  });
});
