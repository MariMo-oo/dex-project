// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IDEX.sol";

contract Arbitrage {

    // ── State ─────────────────────────────────────────────────────────────────
    address public immutable owner;
    IDEX    public immutable dex1;
    IDEX    public immutable dex2;
    IERC20  public immutable tokenA;
    IERC20  public immutable tokenB;

    /// @notice Minimum profit required to execute (in TokenA, scaled 1e18)
    uint256 public minProfitThreshold;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant FEE_NUM   = 997;
    uint256 private constant FEE_DEN   = 1000;

    // ── Events ────────────────────────────────────────────────────────────────
    event ArbitrageExecuted(
        uint8   direction,
        uint256 amountIn,
        uint256 intermediateOut,
        uint256 finalOut,
        uint256 profit
    );
    event ArbitrageSkipped(string reason, int256 simulatedProfit1, int256 simulatedProfit2);
    event ThresholdUpdated(uint256 newThreshold);


    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Arbitrage: not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _dex1,
        address _dex2,
        address _tokenA,
        address _tokenB,
        uint256 _minProfitThreshold
    ) {
        require(_dex1 != address(0) && _dex2 != address(0), "Arbitrage: zero dex");
        require(_tokenA != address(0) && _tokenB != address(0), "Arbitrage: zero token");
        owner               = msg.sender;
        dex1                = IDEX(_dex1);
        dex2                = IDEX(_dex2);
        tokenA              = IERC20(_tokenA);
        tokenB              = IERC20(_tokenB);
        minProfitThreshold  = _minProfitThreshold;
    }

    // ── Internal: AMM output formula ──────────────────────────────────────────
    /**
     * @dev Computes swap output using x*y=k with 0.3% fee.
     *      amountOut = (reserveOut * amountIn * 997) / (reserveIn * 1000 + amountIn * 997)
     *      Multiply before divide to avoid truncation loss.
     */
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        require(amountIn > 0,   "Arbitrage: zero input");
        require(reserveIn > 0 && reserveOut > 0, "Arbitrage: empty reserve");
        uint256 amountInWithFee = amountIn * FEE_NUM;
        return (reserveOut * amountInWithFee) / (reserveIn * FEE_DEN + amountInWithFee);
    }

    // ── Price comparison ──────────────────────────────────────────────────────
    /**
     * @notice Compare spot prices from both DEXes using their spotPrice() functions.
     * @return price1 Spot price on DEX1 (A/B ratio ×1e18)
     * @return price2 Spot price on DEX2 (A/B ratio ×1e18)
     * @return discrepancy Whether a price difference exists
     */
    function comparePrices()
        public view
        returns (uint256 price1, uint256 price2, bool discrepancy)
    {
        price1 = dex1.getSpotPrice(); // reserveA1/reserveB1 ×1e18
        price2 = dex2.getSpotPrice(); // reserveA2/reserveB2 ×1e18
        discrepancy = (price1 != price2);
    }

    // ── Simulate both directions ──────────────────────────────────────────────
    /**
     * @notice Simulate profit for both arbitrage directions without executing.
     *
     * Direction 1 (A→B→A via DEX1 then DEX2):
     *   amountIn TKA → DEX1 → TKB → DEX2 → TKA
     *
     * Direction 2 (A→B→A via DEX2 then DEX1):
     *   amountIn TKA → DEX2 → TKB → DEX1 → TKA
     *
     * @param amountIn Amount of TokenA to simulate with
     * @return profit1 Net profit for direction 1 (can be negative)
     * @return profit2 Net profit for direction 2 (can be negative)
     * @return bestDirection 1 or 2, whichever is more profitable (0 if neither)
     */
    function simulateBothDirections(uint256 amountIn)
        public view
        returns (int256 profit1, int256 profit2, uint8 bestDirection)
    {
        (uint256 rA1, uint256 rB1) = dex1.getReserves();
        (uint256 rA2, uint256 rB2) = dex2.getReserves();

        // Direction 1: A → B on DEX1, then B → A on DEX2
        uint256 bOut1  = _getAmountOut(amountIn, rA1, rB1);
        uint256 aOut1  = _getAmountOut(bOut1,    rB2, rA2);
        profit1 = int256(aOut1) - int256(amountIn);

        // Direction 2: A → B on DEX2, then B → A on DEX1
        uint256 bOut2  = _getAmountOut(amountIn, rA2, rB2);
        uint256 aOut2  = _getAmountOut(bOut2,    rB1, rA1);
        profit2 = int256(aOut2) - int256(amountIn);

        // Pick the best direction
        bool dir1Profitable = profit1 > 0 && uint256(profit1) >= minProfitThreshold;
        bool dir2Profitable = profit2 > 0 && uint256(profit2) >= minProfitThreshold;

        if (dir1Profitable && dir2Profitable) {
            bestDirection = profit1 >= profit2 ? 1 : 2;
        } else if (dir1Profitable) {
            bestDirection = 1;
        } else if (dir2Profitable) {
            bestDirection = 2;
        } else {
            bestDirection = 0; // no profitable direction
        }
    }

    // ── Main arbitrage function ───────────────────────────────────────────────
    /**
     * @notice Main entry point. Detects opportunity and executes if profitable.
     *         Uses the contract's own TokenA capital (must be pre-funded).
     *         Returns principal + profit to the caller (owner).
     *
     * @param amountIn Amount of the contract's TokenA capital to use.
     */
    function executeArbitrage(uint256 amountIn)
        external
        onlyOwner
        returns (uint256 finalTokenA)
    {
        require(amountIn > 0, "Arbitrage: zero amount");
        require(
            tokenA.balanceOf(address(this)) >= amountIn,
            "Arbitrage: insufficient capital"
        );

        // ── Step 1: Compare prices ──────────────────────────────────
        (,, bool discrepancy) = comparePrices();

        if (!discrepancy) {
            emit ArbitrageSkipped("Prices are equal on both DEXes", 0, 0);
            revert("Arbitrage: no price discrepancy");
        }

        // ── Step 2: Simulate both directions ───────────────────────
        (int256 profit1, int256 profit2, uint8 bestDir) = simulateBothDirections(amountIn);

        if (bestDir == 0) {
            emit ArbitrageSkipped("No profitable direction found", profit1, profit2);
            revert("Arbitrage: no profitable opportunity");
        }

        uint256 tokenABefore = tokenA.balanceOf(address(this));

        // ── Step 3: Execute ─────────────────────────────────────────
        uint256 bReceived;
        uint256 aReceived;

        if (bestDir == 1) {
            // Direction 1: A→B on DEX1, then B→A on DEX2
            tokenA.approve(address(dex1), amountIn);
            bReceived = dex1.swap(address(tokenA), amountIn, 0);

            tokenB.approve(address(dex2), bReceived);
            aReceived = dex2.swap(address(tokenB), bReceived, 0);

        } else {
            // Direction 2: A→B on DEX2, then B→A on DEX1
            tokenA.approve(address(dex2), amountIn);
            bReceived = dex2.swap(address(tokenA), amountIn, 0);

            tokenB.approve(address(dex1), bReceived);
            aReceived = dex1.swap(address(tokenB), bReceived, 0);
        }

        // ── Step 4: Verify on-chain profit ──────────────────────────
        uint256 tokenAAfter = tokenA.balanceOf(address(this));
        require(tokenAAfter > tokenABefore, "Arbitrage: trade not profitable");

        uint256 actualProfit = tokenAAfter - tokenABefore;
        require(actualProfit >= minProfitThreshold, "Arbitrage: profit below threshold");

        // ── Step 5: Return capital + profit to owner ────────────────
        finalTokenA = tokenAAfter;
        tokenA.transfer(owner, finalTokenA);

        emit ArbitrageExecuted(bestDir, amountIn, bReceived, aReceived, actualProfit);
    }

    // ── Admin functions ───────────────────────────────────────────────────────
    function setMinProfitThreshold(uint256 newThreshold) external onlyOwner {
        minProfitThreshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    /// @notice Fund the contract with TokenA capital
    function fundCapital(uint256 amount) external onlyOwner {
        tokenA.transferFrom(msg.sender, address(this), amount);
    }

    /// @notice Withdraw all capital back to owner
    function withdrawCapital() external onlyOwner {
        uint256 balA = tokenA.balanceOf(address(this));
        uint256 balB = tokenB.balanceOf(address(this));
        if (balA > 0) tokenA.transfer(owner, balA);
        if (balB > 0) tokenB.transfer(owner, balB);
    }

    /// @notice Returns current capital held by contract
    function getCapital() external view returns (uint256 capA, uint256 capB) {
        return (tokenA.balanceOf(address(this)), tokenB.balanceOf(address(this)));
    }
}
