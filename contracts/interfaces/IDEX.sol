// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDEX {
    function swap(address tokenIn, uint256 amountIn, uint256 amountOutMin)
        external returns (uint256 amountOut);
    function getReserves() external view returns (uint256 reserveA, uint256 reserveB);
    function getPriceA()    external view returns (uint256);
    function getPriceB()    external view returns (uint256);
    function getSpotPrice() external view returns (uint256);
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
}
