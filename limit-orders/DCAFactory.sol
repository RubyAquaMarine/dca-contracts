// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";
import "./DCAStorage.sol";
import "../interfaces/IRubyNFT.sol";
import "../token_mappings/RubyToken.sol";

contract DCAFactory is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public NFTAddress; // Set erc721 collection
    bool public TradingEnabled;
    address public Relayer;
    address public Router;
    uint256 public EntryFee;
    uint256 public MAX_ORDERS = 250;
    uint256 public StorageID; // storage length : starts at 1
    mapping(uint256 => DCAStorage) public allStorages;

    address public USDP;
    address public RUBY;
    uint256 public index; //from 0

     struct OrderDetails {
        uint256 index;
        address trader;
        uint256 interval;
        uint256 tokenPriceMin;
        uint256 tokenPriceMax;
        uint256 tokenAmount;
        bool buyOrder;
        uint256 lastSwapCount;
        uint256 lastSwapTime;
        uint256 totalSwapSum;
    }

    event DCAStorageCreated(uint256 _dcaStorageId, address _dcaStorage, address _tokenXYZ);

    constructor(
        address _relayer,
        address _router,
        address _usdp,
        address _ruby
    ) public {
        require(_relayer != address(0), "Factory: Missing RELAYER address");
        require(_router != address(0), "Factory: Missing ROUTER address");
        require(_usdp != address(0), "Factory: Missing USDP address");
        require(_ruby != address(0), "Factory: Missing RUBY address");
        Relayer = _relayer;
        Router = _router;
        USDP = _usdp;
        RUBY = _ruby;
        EntryFee = 1e18; //Default fee is 1 RUBY
        TradingEnabled = true;
        index = 0;
    }

    // returns all the indexes
    function GetAllOrders(uint256 _dcaStorageID, address _trader) public view returns (uint256[] memory) {
        require(_dcaStorageID > 0, "DCAFactory: GetAllOrders: incorrect index");
        require(_trader != address(0), "DCAFactory: GetAllOrders: incorrect trader address");
        address dca = GetStorageAddressUsingIndex(_dcaStorageID);
        (uint256[] memory indexes, uint256 buyCount, uint256 sellCount) = DCAStorage(dca).GetMyOrderDetails(
            _trader
        );
        if (buyCount > 0 || sellCount > 0) {
            return (indexes);
        }
    }

    // Working
    function GetOrderDetails(uint256 _dcaStorageID, uint256 _index)
        public
        view
        returns (OrderDetails memory)
    {
        (
            uint256 index,
            address trader,
            uint256 interval,
            uint256 tokenPriceMin,
            uint256 tokenPriceMax,
            uint256 tokenAmount,
            bool buyOrder,
            uint256 lastSwapCount,
            uint256 lastSwapTime,
            uint256 totalSwapSum
        ) = DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).GetOrderDetails(_index);

        OrderDetails memory order;
        order.index = index;
        order.trader = trader;
        order.interval = interval;
        order.tokenPriceMin = tokenPriceMin;
        order.tokenPriceMax = tokenPriceMax;
        order.tokenAmount = tokenAmount;
        order.buyOrder = buyOrder;
        order.lastSwapTime = lastSwapTime;
        order.lastSwapCount = lastSwapCount;
        order.totalSwapSum = totalSwapSum;
        return order;
    }

    function GetTokenXYZUsingIndex(uint256 _dcaStorageID) public view returns (address) {
        require(_dcaStorageID > 0, "DCAFactory: DCAStorageID: incorrect index");
        return DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).TokenXYZ();
    }

    function GetOrderLength(uint256 _dcaStorageID) public view returns (uint256) {
        require(_dcaStorageID > 0, "DCAFactory: DCAStorageID: incorrect index");
        return DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).OrdersLength();
    }

    function GetOrderFilled(uint256 _dcaStorageID) public view returns (uint256) {
        require(_dcaStorageID > 0, "DCAFactory: DCAStorageID: incorrect index");
        return DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).OrdersFilled();
    }

    function GetOrdersTotal(uint256 _dcaStorageID) public view returns (uint256) {
        require(_dcaStorageID > 0, "DCAFactory: DCAStorageID: incorrect index");
        return DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).OrdersTotal();
    }

    function GetLastPoolPrice(uint256 _dcaStorageID) public view returns (uint256) {
        require(_dcaStorageID > 0, "DCAFactory: DCAStorageID: incorrect index");
        return DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).LastPoolPrice();
    }

    // input index : return the correct Storage address
    function GetStorageAddressUsingIndex(uint256 _dcaStorageID) public view returns (address) {
        require(_dcaStorageID <= StorageID, "DCAFactory: DCAStorage: incorrect index");
        require(_dcaStorageID > 0, "DCAFactory: DCAStorage: incorrect index");
        return address(allStorages[_dcaStorageID]);
    }

    // find the available storage SC or deploy one if needed
    function GetStorageAddressUsingToken(address _tokenXYZ) public returns (address) {
        require(_tokenXYZ != address(0), "DCAFactory: DCAStorageID: incorrect token address");
        for (uint256 i = 1; i <= StorageID; i++) {
            address dca = GetStorageAddressUsingIndex(i);
            address symbol = DCAStorage(dca).TokenXYZ();
            // match correct tokenXYZ
            if (_tokenXYZ == symbol) {
                // check order length
                uint256 orderLength = DCAStorage(dca).OrdersLength();
                if (orderLength < MAX_ORDERS) {
                    return dca;
                }
            }
        }
        return _deployDCAStorage(_tokenXYZ);
    }

    function ExecuteOrders(uint256 _dcaStorageID, bool _buyOrder) public {
        require(_dcaStorageID > 0, "DCAFactory: DCAStorageID: incorrect index");
        DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).ExecuteOrders(_buyOrder);
    }

    function GetIndexUsingStorageAddress(address _storageAddress) public view returns (uint256) {
        require(_storageAddress != address(0), "DCAFactory: DCAStorageID: incorrect storage address");
        for (uint256 i = 1; i <= StorageID; i++) {
            address dca = GetStorageAddressUsingIndex(i);
            // match correct
            if (dca == _storageAddress) {
                return i;
            }
        }
        return 0;
    }

    function ExecuteOrderRange(uint256 _from) public returns (uint256) {
        require(_from > 0, "DCAFactory: DCAStorageID: incorrect index");
        uint256 executed = 0; // add up the executed orders
        uint256 countOrders;
        for (uint256 i = _from; i <= StorageID; i++) {
            address dca = GetStorageAddressUsingIndex(i);
            // check order length
            uint256 orderLength = DCAStorage(dca).OrdersLength();
            countOrders = countOrders.add(orderLength);
            // will this exceed the limit
            if (executed.add(countOrders) > MAX_ORDERS) {
                //yes, return this storage id, to process on the next block
                return i;
            } else {
                DCAStorage(dca).ExecuteOrders(true);
                DCAStorage(dca).ExecuteOrders(false);
                executed = executed.add(countOrders);
            }
        }
        return 1; //default
    }

    function SubmitDCAOrder(
        address _tokenXYZ,
        uint256 _intervalSeconds,
        uint256 _durationHours,
        uint256 _tokenPriceMin,
        uint256 _tokenPriceMax,
        uint256 _tokenAmount,
        bool _buyOrder
    ) public {
        require(TradingEnabled == true, "Trading is off");
        address storageAddress = _findContractAddress(_tokenXYZ); // new DCA is deployed if needed
        require(storageAddress != address(0), "No Storage Contract Found for Token");

        bool funded = false;
        _transferRubyToFactory(); // collect Ruby Fee
        if (_buyOrder) {
            _transferUSDPToStorage(_tokenAmount, storageAddress);
            funded = true;
        } else {
            _transferQuoteToStorage(_tokenXYZ, _tokenAmount, storageAddress);
            funded = true;
        }
        if (funded) {
            DCAStorage(storageAddress).SubmitDCAOrderFromFactory(
                index,
                _intervalSeconds,
                _durationHours,
                _tokenPriceMin,
                _tokenPriceMax,
                _tokenAmount,
                _buyOrder
            );
            index ++;
        }
    }

    function DeleteOrder(uint256 _dcaStorageID, uint256 _index) public {
        require(_dcaStorageID > 0, "DCAFactory: DeleteOrder: incorrect orderTicketNumber");
        DCAStorage(GetStorageAddressUsingIndex(_dcaStorageID)).DeleteOrderFromFacotry(_index);
    }

    function BurnRuby() external onlyOwner {
        uint256 toburn = IERC20(RUBY).balanceOf(address(this));
        RubyToken(RUBY).burn(toburn);
    }

    function ChangeEntryFee(uint256 _fee) external onlyOwner {
        EntryFee = _fee;
    }

    function ChangeRelayer(address _newRelayer) external onlyOwner {
        Relayer = _newRelayer;
    }

    function ChangeMaxOrders(uint256 _maxOrders) external onlyOwner {
        MAX_ORDERS = _maxOrders;
    }

    function TradingCondition(bool _on_off) external onlyOwner {
        TradingEnabled = _on_off;
    }

    function setNftAddress(address newAddress) external onlyOwner {
        require(address(newAddress) != address(0), "DCA Facotry: newNFT Address");
        NFTAddress = newAddress;
    }

    function _transferRubyToFactory() private {
        address usersWallet = msg.sender;
        bool freeOrdersNFT = false;

        if (address(NFTAddress) != address(0)) {
            if (IRubyNFT(NFTAddress).balanceOf(usersWallet) > 0) {
                freeOrdersNFT = true;
            }
        }

        if (freeOrdersNFT) {
            return;
        } else {
            IERC20 token = IERC20(RUBY);
            require(token.balanceOf(usersWallet) >= EntryFee, "Insufficient token (RUBY) balance");
            token.safeTransferFrom(usersWallet, address(this), EntryFee); // SEND TO FACTORY
        }
    }

    function _transferQuoteToStorage(
        address _tokenXYZ,
        uint256 _amount,
        address _storageContractAddress
    ) private {
        address usersWallet = msg.sender;
        IERC20 token = IERC20(_tokenXYZ);
        require(token.balanceOf(usersWallet) >= _amount, "Insufficient token balance");
        token.safeTransferFrom(usersWallet, _storageContractAddress, _amount);
    }

    function _transferUSDPToStorage(uint256 _amount, address _storageContractAddress) private {
        address usersWallet = msg.sender;
        IERC20 token = IERC20(USDP);
        require(token.balanceOf(usersWallet) >= _amount, "Insufficient token (USDP) balance");
        token.safeTransferFrom(usersWallet, _storageContractAddress, _amount);
    }

    function _deployDCAStorage(address _tokenXYZ) private returns (address) {
        require(_tokenXYZ != address(0), "DCAFactory: DCAStorage: tokenXYZ cannot be 0 address");
        StorageID++;
        allStorages[StorageID] = new DCAStorage(StorageID, address(this), Router, USDP, _tokenXYZ, RUBY);
        emit DCAStorageCreated(StorageID, address(allStorages[StorageID]), _tokenXYZ);
        return address(allStorages[StorageID]);
    }

    function _findContractAddress(address _tokenXYZ) private returns (address) {
        require(_tokenXYZ != address(0), "DCAFactory: _findContractAddress: incorrect token");
        address check = GetStorageAddressUsingToken(_tokenXYZ);
        return check;
    }
}
