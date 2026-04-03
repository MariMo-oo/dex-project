// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title LPToken
 * @notice ERC-20 LP token. Only the DEX contract (owner) can mint and burn.
 */
contract LPToken is ERC20 {
    address public immutable dex;

    modifier onlyDEX() {
        require(msg.sender == dex, "LPToken: caller is not DEX");
        _;
    }

    constructor(address _dex) ERC20("DEX LP Token", "DLP") {
        require(_dex != address(0), "LPToken: zero address");
        dex = _dex;
    }

    function mint(address to, uint256 amount) external onlyDEX {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyDEX {
        _burn(from, amount);
    }
}
