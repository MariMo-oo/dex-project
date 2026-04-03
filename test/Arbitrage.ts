import { expect } from "chai";
import { network } from "hardhat";

describe("Arbitrage — Task 3", function () {

  /**
   * Deploy helper: uses nonce prediction so LPToken gets DEX address
   * before DEX is deployed (they mutually reference each other).
   */
  async function deployDEXPair(ethers: any, owner: any, addrA: string, addrB: string) {
    const nonce    = await ethers.provider.getTransactionCount(owner.address);
    const dexAddr  = ethers.getCreateAddress({ from: owner.address, nonce });
    const lpAddr   = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });

    const dex = await ethers.deployContract("DEX",     [addrA, addrB, lpAddr]);
    const lp  = await ethers.deployContract("LPToken", [dexAddr]);

    return { dex, lp, dexAddr, lpAddr };
  }

  async function baseFixture() {
    const { ethers } = await network.connect();
    const [owner] = await ethers.getSigners();

    // Deploy tokens (TokenA and TokenB are instances of Token.sol)
    const tokenA = await ethers.deployContract("Token", ["Token A", "TKA", 10_000_000]);
    const tokenB = await ethers.deployContract("Token", ["Token B", "TKB", 10_000_000]);
    const addrA  = await tokenA.getAddress();
    const addrB  = await tokenB.getAddress();

    const { dex: dex1, dexAddr: dex1Addr } = await deployDEXPair(ethers, owner, addrA, addrB);
    const { dex: dex2, dexAddr: dex2Addr } = await deployDEXPair(ethers, owner, addrA, addrB);

    // Approve both DEXes for unlimited spending
    await tokenA.approve(dex1Addr, ethers.MaxUint256);
    await tokenB.approve(dex1Addr, ethers.MaxUint256);
    await tokenA.approve(dex2Addr, ethers.MaxUint256);
    await tokenB.approve(dex2Addr, ethers.MaxUint256);

    return { ethers, owner, tokenA, tokenB, addrA, addrB, dex1, dex2, dex1Addr, dex2Addr };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Profitable Arbitrage Execution
  // ══════════════════════════════════════════════════════════════════════════
  describe("Scenario 1: Profitable arbitrage execution", function () {

    it("detects discrepancy, picks best direction, executes and profits", async function () {
      const { ethers, owner, tokenA, tokenB, addrA, addrB,
              dex1, dex2, dex1Addr, dex2Addr } = await baseFixture();

      // ── Seed DEX1: 1000 A : 2000 B  → price = 2.0 B/A ──────────
      await dex1.addLiquidity(
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("2000", 18)
      );

      // ── Seed DEX2: 1000 A : 2100 B  → price = 2.1 B/A ──────────
      // Matches the assignment example exactly
      await dex2.addLiquidity(
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("2100", 18)
      );

      // ── Deploy Arbitrage contract ────────────────────────────────
      const MIN_PROFIT = ethers.parseUnits("0.01", 18); // 0.01 TKA threshold
      const arb = await ethers.deployContract("Arbitrage", [
        dex1Addr, dex2Addr, addrA, addrB, MIN_PROFIT
      ]);
      const arbAddr = await arb.getAddress();

      // ── Fund contract with capital ───────────────────────────────
      const capital = ethers.parseUnits("10", 18); // 10 TKA (matches assignment)
      await tokenA.approve(arbAddr, ethers.MaxUint256);
      await arb.fundCapital(capital);

      // Verify capital is in contract
      const [capA] = await arb.getCapital();
      expect(capA).to.equal(capital);

      // ── Check prices before ──────────────────────────────────────
      const [price1, price2, discrepancy] = await arb.comparePrices();
      console.log("\n  ── Scenario 1: Profitable Arbitrage ────────────────");
      console.log(`  DEX1 spot price (A/B): ${ethers.formatUnits(price1, 18)}`);
      console.log(`  DEX2 spot price (A/B): ${ethers.formatUnits(price2, 18)}`);
      console.log(`  Price discrepancy:     ${discrepancy}`);
      expect(discrepancy).to.be.true;

      // ── Simulate both directions ─────────────────────────────────
      const [profit1, profit2, bestDir] = await arb.simulateBothDirections(capital);
      console.log(`\n  Simulated profit Dir1: ${ethers.formatUnits(profit1 < 0n ? -profit1 : profit1, 18)} ${profit1 >= 0n ? "TKA (gain)" : "TKA (loss)"}`);
      console.log(`  Simulated profit Dir2: ${ethers.formatUnits(profit2 < 0n ? -profit2 : profit2, 18)} ${profit2 >= 0n ? "TKA (gain)" : "TKA (loss)"}`);
      console.log(`  Best direction:        ${bestDir}`);
      expect(bestDir).to.be.gt(0, "Should find a profitable direction");

      // ── Execute ──────────────────────────────────────────────────
      const ownerBalBefore = await tokenA.balanceOf(owner.address);
      await arb.executeArbitrage(capital);
      const ownerBalAfter = await tokenA.balanceOf(owner.address);

      const actualProfit = ownerBalAfter - ownerBalBefore;
      console.log(`\n  Owner TKA before: ${ethers.formatUnits(ownerBalBefore, 18)}`);
      console.log(`  Owner TKA after:  ${ethers.formatUnits(ownerBalAfter, 18)}`);
      console.log(`  Actual profit:    ${ethers.formatUnits(actualProfit, 18)} TKA`);

      // Owner should have MORE than before (capital + profit returned)
      expect(ownerBalAfter).to.be.gt(ownerBalBefore,
        "Owner should receive capital + profit");

      // Contract should be empty after execution
      const [capAfter] = await arb.getCapital();
      expect(capAfter).to.equal(0n, "Contract capital should be returned to owner");

      // k invariant on both pools should hold
      const [rA1, rB1] = await dex1.getReserves();
      const [rA2, rB2] = await dex2.getReserves();
      expect(rA1 * rB1).to.be.gte(
        ethers.parseUnits("1000", 18) * ethers.parseUnits("2000", 18),
        "DEX1 k should not decrease"
      );
      expect(rA2 * rB2).to.be.gte(
        ethers.parseUnits("1000", 18) * ethers.parseUnits("2100", 18),
        "DEX2 k should not decrease"
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Failed Arbitrage (Insufficient Profit)
  // ══════════════════════════════════════════════════════════════════════════
  describe("Scenario 2: Failed arbitrage — insufficient profit", function () {

    it("reverts when prices are equal (no discrepancy)", async function () {
      const { ethers, owner, tokenA, addrA, addrB,
              dex1, dex2, dex1Addr, dex2Addr } = await baseFixture();

      // ── Both DEXes seeded with identical reserves ────────────────
      const amt = ethers.parseUnits("1000", 18);
      await dex1.addLiquidity(amt, amt);
      await dex2.addLiquidity(amt, amt);

      const MIN_PROFIT = ethers.parseUnits("0.01", 18);
      const arb = await ethers.deployContract("Arbitrage", [
        dex1Addr, dex2Addr, addrA, addrB, MIN_PROFIT
      ]);
      const arbAddr = await arb.getAddress();

      await tokenA.approve(arbAddr, ethers.MaxUint256);
      const capital = ethers.parseUnits("10", 18);
      await arb.fundCapital(capital);

      const [price1, price2, discrepancy] = await arb.comparePrices();
      console.log("\n  ── Scenario 2: Failed Arbitrage (equal prices) ─────");
      console.log(`  DEX1 spot price: ${ethers.formatUnits(price1, 18)}`);
      console.log(`  DEX2 spot price: ${ethers.formatUnits(price2, 18)}`);
      console.log(`  Discrepancy:     ${discrepancy}`);

      const [profit1, profit2, bestDir] = await arb.simulateBothDirections(capital);
      console.log(`  Simulated profit Dir1: ${ethers.formatUnits(profit1 < 0n ? -profit1 : profit1, 18)} ${profit1 >= 0n ? "(gain)" : "(loss)"}`);
      console.log(`  Simulated profit Dir2: ${ethers.formatUnits(profit2 < 0n ? -profit2 : profit2, 18)} ${profit2 >= 0n ? "(gain)" : "(loss)"}`);
      console.log(`  Best direction:        ${bestDir} (0 = none)`);

      // Should revert with no opportunity
      await expect(
        arb.executeArbitrage(capital)
      ).to.be.revertedWith("Arbitrage: no profitable opportunity");

      // Capital still in contract — owner did not lose anything
      const [capAfter] = await arb.getCapital();
      expect(capAfter).to.equal(capital, "Capital must stay in contract on failure");
      console.log("  Capital preserved: ✓");
    });

    it("reverts when spread too small — profit below threshold", async function () {
      const { ethers, owner, tokenA, addrA, addrB,
              dex1, dex2, dex1Addr, dex2Addr } = await baseFixture();

      // ── Tiny price difference — 1000:2000 vs 1000:2001 ──────────
      // Spread is ~0.05%, not enough to beat 2×0.3% fees
      await dex1.addLiquidity(
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("2000", 18)
      );
      await dex2.addLiquidity(
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("2001", 18)
      );

      // Set a very high threshold that won't be met
      const HIGH_THRESHOLD = ethers.parseUnits("100", 18); // 100 TKA required profit
      const arb = await ethers.deployContract("Arbitrage", [
        dex1Addr, dex2Addr, addrA, addrB, HIGH_THRESHOLD
      ]);
      const arbAddr = await arb.getAddress();

      await tokenA.approve(arbAddr, ethers.MaxUint256);
      const capital = ethers.parseUnits("10", 18);
      await arb.fundCapital(capital);

      console.log("\n  ── Scenario 2b: Profit below threshold ─────────────");
      console.log(`  Minimum threshold: 100 TKA`);

      const [p1, p2, bestDir] = await arb.simulateBothDirections(capital);
      console.log(`  Simulated profit Dir1: ${ethers.formatUnits(p1 < 0n ? -p1 : p1, 18)} ${p1 >= 0n ? "(gain)" : "(loss)"}`);
      console.log(`  Simulated profit Dir2: ${ethers.formatUnits(p2 < 0n ? -p2 : p2, 18)} ${p2 >= 0n ? "(gain)" : "(loss)"}`);
      console.log(`  Best direction: ${bestDir} (0 = none — below threshold)`);

      await expect(
        arb.executeArbitrage(capital)
      ).to.be.revertedWith("Arbitrage: no profitable opportunity");

      const [capAfter] = await arb.getCapital();
      expect(capAfter).to.equal(capital, "Capital preserved on failed arb");
      console.log("  Capital preserved: ✓");
    });
  });
});
