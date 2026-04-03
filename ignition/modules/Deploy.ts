import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("FullDeploy", (m) => {
  // 1. Deploy tokens
  const tokenA = m.contract("Token", ["Token A", "TKA", 1_000_000]);
  const tokenB = m.contract("Token", ["Token B", "TKB", 1_000_000]);

  // 2. Deploy DEX with placeholder (address gets set post-deploy in tests)
  //    In practice: deploy DEX first with a dummy LP, then deploy real LP pointing at DEX.
  //    For tests, we handle the two-step in the fixture directly.

  return { tokenA, tokenB };
});
