// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LPToken.sol";

/**
 * @title DEX
 * @notice Constant-product AMM (x*y=k) with 0.3% swap fee.
 *         Uses a separate LPToken contract for LP share management.
 */
contract DEX is ReentrancyGuard {

    IERC20    public immutable tokenA;
    IERC20    public immutable tokenB;
    LPToken   public immutable lpToken;

    uint256 public reserveA;
    uint256 public reserveB;

    uint256 private constant FEE_NUM   = 997;
    uint256 private constant FEE_DEN   = 1000;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant TOLERANCE = 1e15; // 0.1% ratio tolerance

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event Swap(address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, address _lpToken) {
        require(_tokenA != address(0) && _tokenB != address(0), "DEX: zero address");
        require(_tokenA != _tokenB, "DEX: identical tokens");
        require(_lpToken != address(0), "DEX: zero lp address");
        tokenA  = IERC20(_tokenA);
        tokenB  = IERC20(_tokenB);
        lpToken = LPToken(_lpToken);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y; uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) { z = 1; }
    }

    // ── Add Liquidity ──────────────────────────────────────────────
    function addLiquidity(uint256 amountA, uint256 amountB)
        external nonReentrant returns (uint256 shares)
    {
        require(amountA > 0 && amountB > 0, "DEX: zero amount");

        if (reserveA == 0 && reserveB == 0) {
            shares = _sqrt(amountA * amountB);
        } else {
            // Enforce ratio: amountA * reserveB == amountB * reserveA (with tolerance)
            uint256 lhs  = amountA * reserveB;
            uint256 rhs  = amountB * reserveA;
            uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;
            uint256 base = lhs > rhs ? lhs : rhs;
            require(diff * PRECISION <= base * TOLERANCE, "DEX: ratio violated");
            shares = (amountA * lpToken.totalSupply()) / reserveA;
        }

        require(shares > 0, "DEX: zero shares");

        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        lpToken.mint(msg.sender, shares);
        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, shares);
    }

    // ── Swap ───────────────────────────────────────────────────────
    function swap(address _tokenIn, uint256 amountIn, uint256 amountOutMin)
        external nonReentrant returns (uint256 amountOut)
    {
        require(amountIn > 0, "DEX: zero input");
        require(
            _tokenIn == address(tokenA) || _tokenIn == address(tokenB),
            "DEX: invalid token"
        );

        bool isA = (_tokenIn == address(tokenA));
        (IERC20 inToken, IERC20 outToken, uint256 resIn, uint256 resOut) =
            isA ? (tokenA, tokenB, reserveA, reserveB)
                : (tokenB, tokenA, reserveB, reserveA);

        inToken.transferFrom(msg.sender, address(this), amountIn);

        uint256 amountInFee = amountIn * FEE_NUM;
        amountOut = (resOut * amountInFee) / (resIn * FEE_DEN + amountInFee);

        require(amountOut > 0, "DEX: zero output");
        require(amountOut >= amountOutMin, "DEX: slippage exceeded");
        require(amountOut < resOut, "DEX: insufficient liquidity");

        outToken.transfer(msg.sender, amountOut);
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));

        emit Swap(msg.sender, _tokenIn, amountIn, amountOut);
    }

    // ── Remove Liquidity ───────────────────────────────────────────
    function removeLiquidity(uint256 shares)
        external nonReentrant returns (uint256 amountA, uint256 amountB)
    {
        require(shares > 0, "DEX: zero shares");
        require(lpToken.balanceOf(msg.sender) >= shares, "DEX: insufficient shares");

        uint256 supply = lpToken.totalSupply();
        amountA = (reserveA * shares) / supply;
        amountB = (reserveB * shares) / supply;

        require(amountA > 0 && amountB > 0, "DEX: zero withdrawal");

        lpToken.burn(msg.sender, shares);
        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, shares);
    }

    // ── View functions ─────────────────────────────────────────────
    function getReserves() external view returns (uint256, uint256) {
        return (reserveA, reserveB);
    }

    /// @notice Spot price of TokenA in terms of TokenB (×1e18)
    function getPriceA() external view returns (uint256) {
        require(reserveA > 0, "DEX: empty pool");
        return (reserveB * PRECISION) / reserveA;
    }

    /// @notice Spot price of TokenB in terms of TokenA (×1e18)
    function getPriceB() external view returns (uint256) {
        require(reserveB > 0, "DEX: empty pool");
        return (reserveA * PRECISION) / reserveB;
    }

    /// @notice Reserve ratio A/B (×1e18) — the Spot Price per assignment definition
    function getSpotPrice() external view returns (uint256) {
        require(reserveA > 0 && reserveB > 0, "DEX: empty pool");
        return (reserveA * PRECISION) / reserveB;
    }
}
