import { expect } from "chai";
import { network } from "hardhat";

describe("ERC20 Tokens", function () {

  async function deployTokensFixture() {
    const { ethers } = await network.connect();
    const [owner, alice, bob] = await ethers.getSigners();

    const tokenA = await ethers.deployContract("TokenA", [1_000_000]);
    const tokenB = await ethers.deployContract("TokenB", [1_000_000]);

    return { tokenA, tokenB, owner, alice, bob };
  }

  describe("TokenA", function () {
    it("Should mint total supply to deployer", async function () {
      const { tokenA, owner } = await deployTokensFixture();
      const supply = await tokenA.totalSupply();
      expect(await tokenA.balanceOf(owner.address)).to.equal(supply);
    });

    it("Should transfer TokenA between users correctly", async function () {
      const { tokenA, alice } = await deployTokensFixture();
      const { ethers } = await network.connect();
      const amount = ethers.parseUnits("100", 18);
      await tokenA.transfer(alice.address, amount);
      expect(await tokenA.balanceOf(alice.address)).to.equal(amount);
    });

    it("Should emit Transfer event", async function () {
      const { tokenA, owner, alice } = await deployTokensFixture();
      const { ethers } = await network.connect();
      const amount = ethers.parseUnits("50", 18);
      await expect(tokenA.transfer(alice.address, amount))
        .to.emit(tokenA, "Transfer")
        .withArgs(owner.address, alice.address, amount);
    });
  });

  describe("TokenB", function () {
    it("Should mint total supply to deployer", async function () {
      const { tokenB, owner } = await deployTokensFixture();
      const supply = await tokenB.totalSupply();
      expect(await tokenB.balanceOf(owner.address)).to.equal(supply);
    });

    it("Should transfer TokenB between users correctly", async function () {
      const { tokenB, alice } = await deployTokensFixture();
      const { ethers } = await network.connect();
      const amount = ethers.parseUnits("200", 18);
      await tokenB.transfer(alice.address, amount);
      expect(await tokenB.balanceOf(alice.address)).to.equal(amount);
    });
  });
});