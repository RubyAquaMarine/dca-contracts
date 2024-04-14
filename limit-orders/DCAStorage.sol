// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../amm/interfaces/IUniswapV2Router02.sol";
import "hardhat/console.sol";


contract DCAStorage is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    uint256 constant MAX_UINT256 = 2 ** 256 - 1;

    uint256 public storageID;
    address public UNISWAP_V2_ROUTER;
    address public TokenXYZ; // Quote Token
    address public TokenRUBY; // Ruby Token
    address public FactoryAddress; //assign the relayer
    uint256 public LastPoolPrice;

    uint256 public OrdersLength; // +/- as orders are entered and filled(-)
    uint256 public OrdersFilled; // when orders are filled value is incremented
    uint256 public OrdersTotal; // when orders are added, value is incremented: does not -- (total Orders placed)

    address[] private pathBuy;
    address[] private pathSell;

    address private USDP; // Base Token

    event NewDCAStrategy(
        uint256 index,
        uint256 storageID,
        address trader,
        uint256 interval,
        uint256 duration,
        uint256 tokenPriceMin,
        uint256 tokenPriceMax,
        uint256 tokenAmount,
        bool buyOrder
    );
    event DeleteDCAStrategy(uint256 index, uint256 storageID);
    event AlterDCAStrategy(
        uint256 index,
        uint256 storageID,
        address trader,
        uint256 interval,
        uint256 tokenPriceMin,
        uint256 tokenPriceMax,
        uint256 tokenAmount,
        bool buyOrder,
        uint256 lastSwapCount,
        uint256 lastSwapTime,
        uint256 totalSwapSum
    );

    // The DCA strategy inputs
    struct OrderDetails {
        // unique identifier
        uint256 index;
        // trader that owns the order
        address trader;
        // amount in seconds between swaps
        uint256 interval;
        // Minimum price within range: in 18-decimal units(wei)
        uint256 tokenPriceMin;
        // Minimum price within range: in 18-decimal units(wei)
        uint256 tokenPriceMax;
        // amount in wei
        uint256 tokenAmount;
        //buy/sell: buying below current price vs selling above current price
        bool buyOrder;
        // swap index for tracking
        uint256 lastSwapCount;
        //last swap time for tracking
        uint256 lastSwapTime;
        //total number of swaps to be executed over the duration period
        uint256 totalSwapSum;
    }

    OrderDetails[] public OrderList; // array for easy order handling

    constructor(
        uint256 _storageID,
        address _relayer,
        address _router,
        address _usdp,
        address _tokenXYZ,
        address _tokenRUBY
    ) public {
        storageID = _storageID;
        FactoryAddress = _relayer;
        UNISWAP_V2_ROUTER = _router;
        USDP = _usdp;
        TokenXYZ = _tokenXYZ;
        TokenRUBY = _tokenRUBY;

        // sell route
        pathSell = new address[](2);
        pathSell[0] = TokenXYZ;
        pathSell[1] = USDP;

        // buy route
        pathBuy = new address[](2);
        pathBuy[0] = USDP;
        pathBuy[1] = TokenXYZ;
    }

    function SubmitDCAOrderFromFactory(
        uint256 index,
        uint256 _intervalSeconds,
        uint256 _durationHours,
        uint256 _tokenPriceMin,
        uint256 _tokenPriceMax,
        uint256 _tokenAmount,
        bool _buyOrder
    ) public {
        require(msg.sender == FactoryAddress, "Only from FactoryAddress");
        require(_intervalSeconds >= 1, "Incorrect Swap Interval");
        require(_durationHours >= 1, "Incorrect Duration Interval");
        require(_tokenPriceMin >= 1, "Incorrect Token Minimum Price");
        require(_tokenPriceMax > _tokenPriceMin, "Incorrect Token Maximum Price");
        require(_tokenAmount >= 1, "Insufficient Token Input Amount");
        require((_buyOrder == true || _buyOrder == false), "Incorrect Order Type");
        require(OrdersTotal < MAX_UINT256, "Maximum Orders Reached");

        uint256 duration = _durationHours.mul(3600); // Hours times 60 minutes times 60 seconds (1hour = 3600)
        uint256 swaps = duration.div(_intervalSeconds); // total number of swaps

        require(swaps >= 1, "Incorrect Total Swap Result");

        // Create the Order details
        OrderDetails memory order;
        order.index = index;
        order.trader = tx.origin;
        order.interval = _intervalSeconds;
        order.tokenPriceMin = _tokenPriceMin;
        order.tokenPriceMax = _tokenPriceMax;
        order.tokenAmount = _tokenAmount;
        order.buyOrder = _buyOrder;
        order.lastSwapTime = 0;
        order.lastSwapCount = 1; // First swap is indexed as 1
        order.totalSwapSum = swaps;
        // Register the Order details
        OrderList.push(order);

        emit NewDCAStrategy(
            index,
            storageID,
            tx.origin,
            _intervalSeconds,
            _durationHours,
            _tokenPriceMin,
            _tokenPriceMax,
            _tokenAmount,
            _buyOrder
        );

        OrdersTotal++; // always increments
        OrdersLength++;
    }

    // Delete one order and send any user funds back
    function DeleteOrderFromFacotry(uint256 _index) public {
        _deleteOrder(_index, false);
    }

    function ExecuteOrders(bool _buyOrder) public {
        uint256 ordersFilled;
        uint256 length = OrderList.length;
        // require(length >= 1, "Insufficient order list length");

        uint256 price;

        uint256 minOut = 0;
        uint256[] memory filledOrders = new uint256[](length);

        // create an arry with the same number of elements
        // as orders are filled, add their index into this array
        // then delete those orders
        for (uint256 i = 0; i < length; i++) {
            filledOrders[i] = MAX_UINT256;
        }

        // Execute the swaps
        for (uint256 i = 0; i < length; i++) {
            uint256 swapAmount = OrderList[i].tokenAmount.div(OrderList[i].totalSwapSum);
            uint256 diff = block.timestamp.sub(OrderList[i].interval);
            if (OrderList[i].lastSwapCount <= OrderList[i].totalSwapSum) {
                // get price for each swap
                price = _getAndUpdatePoolPrice();
                // price within range limits
                if (OrderList[i].tokenPriceMin < price && OrderList[i].tokenPriceMax > price) {
                    // swapping USDP to XYZ
                    if (OrderList[i].buyOrder == true && _buyOrder == true) {
                        //skip orders that can't fill the minimum requirement
                        minOut = _checkAmountOut(swapAmount, true);
                        if (OrderList[i].lastSwapTime < diff && swapAmount >= 1 && minOut >= 1) {
                            //buy / swap

                            _swap(USDP, TokenXYZ, swapAmount, minOut, OrderList[i].trader);

                            OrderList[i].lastSwapTime = block.timestamp;
                            OrderList[i].lastSwapCount++; // swap index increments
                            ordersFilled++;
                            if (OrderList[i].lastSwapCount > OrderList[i].totalSwapSum) {
                                // aqua fix bug in not deleting the order when swaps are over
                                filledOrders[i] = OrderList[i].index;
                            }
                            _emitOrderEvent(OrderList[i]);
                        }
                    } else if (OrderList[i].buyOrder == false && _buyOrder == false) {
                        //skip orders that can't fill the minimum requirement
                        minOut = _checkAmountOut(swapAmount, false);
                        if (OrderList[i].lastSwapTime < diff && swapAmount >= 1 && minOut >= 1) {
                            _swap(TokenXYZ, USDP, swapAmount, minOut, OrderList[i].trader);

                            OrderList[i].lastSwapTime = block.timestamp;
                            OrderList[i].lastSwapCount++; // swap index increments
                            ordersFilled++;
                            if (OrderList[i].lastSwapCount > OrderList[i].totalSwapSum) {
                                // aqua fix bug in not deleting the order when swaps are over
                                filledOrders[i] = OrderList[i].index;
                            }
                            _emitOrderEvent(OrderList[i]);
                        }
                    }
                }
            } else {
                // this order shouldn't exist. all to filledOrders[] to delete
                filledOrders[i] = OrderList[i].index;
            }
        }

        // IDEA 1 : just delete 1 order per loop
        for (uint256 i = 0; i < length; i++) {
            uint256 orderTicket = filledOrders[i];

            if (orderTicket != MAX_UINT256) {
                _deleteOrder(orderTicket, true); // update state variable

                break;
            }
        }

        OrdersFilled = OrdersFilled.add(ordersFilled); // update state variable
    }

    function GetMyOrderDetails(address _trader) public view returns (uint256[] memory, uint256, uint256) {
        uint256 length = OrderList.length;
        require(length >= 1, "Insufficient order list length");
        uint256 buy;
        uint256 sell;

        uint256[] memory arr = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            if (OrderList[i].trader == _trader) {
                arr[i] = OrderList[i].index;
                if (OrderList[i].buyOrder == true) {
                    buy++;
                }
                if (OrderList[i].buyOrder == false) {
                    sell++;
                }
            }
        }

        return (arr, buy, sell);
    }

    function GetOrderDetails(
        uint256 _index
    )
        public
        view
        returns (
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
        )
    {
        for (uint256 i = 0; i < OrderList.length; i++) {
            if (OrderList[i].index == _index) {
                index = OrderList[i].index;
                trader = OrderList[i].trader;
                interval = OrderList[i].interval;
                tokenPriceMin = OrderList[i].tokenPriceMin;
                tokenPriceMax = OrderList[i].tokenPriceMax;
                tokenAmount = OrderList[i].tokenAmount;
                buyOrder = OrderList[i].buyOrder;
                lastSwapCount = OrderList[i].lastSwapCount;
                lastSwapTime = OrderList[i].lastSwapTime;
                totalSwapSum = OrderList[i].totalSwapSum;
            }
        }
    }

    function _getAndUpdatePoolPrice() internal returns (uint256) {
        uint256 _amountIn = 1e18;
        // idea
        // amountIN is reduced 1000x and the output is increased 1000x (better price precision for btc and eth)
        uint256 reduceInputAmount = _amountIn.div(1000);
        uint256[] memory amountOutMins = IUniswapV2Router02(UNISWAP_V2_ROUTER).getAmountsOut(
            reduceInputAmount,
            pathSell,
            997
        );
        uint256 output = amountOutMins[pathSell.length - 1];
        output = output.mul(1000);
        LastPoolPrice = output;
        return output;
    }

    function _checkAmountOut(uint256 _amountIn, bool _buyOrder) internal returns (uint256) {
        // path depends on buying or selling ,
        uint256 output;
        if (_buyOrder) {
            uint256[] memory amountOutMins = IUniswapV2Router02(UNISWAP_V2_ROUTER).getAmountsOut(
                _amountIn,
                pathBuy,
                997
            );
            output = amountOutMins[pathBuy.length - 1];
        } else {
            uint256[] memory amountOutMins = IUniswapV2Router02(UNISWAP_V2_ROUTER).getAmountsOut(
                _amountIn,
                pathSell,
                997
            );
            output = amountOutMins[pathSell.length - 1];
        }

        return output;
    }

    function _deleteOrder(uint256 _index, bool _executing) private {
        bool orderFound = false;
        uint256 length = OrderList.length;
        uint256 deleteThisIndex = 0;
        uint256 ordersDecrement = 0;
        require(length >= 1, "Incorrect Order Index given");

        for (uint256 i = 0; i < length; i++) {
            if (_executing) {
                if (OrderList[i].index == _index) {
                    uint256 swapAmount = OrderList[i].tokenAmount.div(OrderList[i].totalSwapSum);
                    uint256 swapped = swapAmount.mul(OrderList[i].lastSwapCount - 1);
                    uint256 tokenAmountDust = OrderList[i].tokenAmount.sub(swapped);
                    // return dust
                    if (OrderList[i].buyOrder == true) {
                        _transferBaseToUser(OrderList[i].trader, tokenAmountDust);
                    } else {
                        _transferQuoteToUser(OrderList[i].trader, tokenAmountDust);
                    }

                    orderFound = true;
                    deleteThisIndex = i;

                    if (orderFound) {
                        break;
                    } else {
                        continue;
                    }
                }
            } else {
                if (OrderList[i].trader == tx.origin) {
                    if (OrderList[i].index == _index) {
                        uint256 swapAmount = OrderList[i].tokenAmount.div(OrderList[i].totalSwapSum);
                        uint256 swapped = swapAmount.mul(OrderList[i].lastSwapCount - 1);
                        uint256 tokenAmountDust = OrderList[i].tokenAmount.sub(swapped);
                        // return dust
                        if (OrderList[i].buyOrder == true) {
                            _transferBaseToUser(OrderList[i].trader, tokenAmountDust);
                        } else {
                            _transferQuoteToUser(OrderList[i].trader, tokenAmountDust);
                        }

                        orderFound = true;
                        deleteThisIndex = i;

                        if (orderFound) {
                            break;
                        } else {
                            continue;
                        }
                    }
                }
            }
        }

        if (orderFound) {
            // more than 1 order exists
            if (length != 1) {
                for (uint256 i = deleteThisIndex; i < length - 1; i++) {
                    // <=
                    OrderList[i] = OrderList[i + 1];
                }
                emit DeleteDCAStrategy(OrderList[length - 1].index, storageID);
                OrderList.pop();
                ordersDecrement++; // becomes 1
            } else {
                 ordersDecrement++; 
                _resetArray();
            }
        }

        OrdersLength = OrdersLength.sub(ordersDecrement);
    }

    // sends RUBY token to SC
    function _transferRubyToStorage() private {
        uint256 _amount = 1e18;
        IERC20 token = IERC20(TokenRUBY);
        require(token.balanceOf(msg.sender) >= _amount, "Insufficient token(RUBY) balance");
        require(msg.sender != address(this), "Only EOA");
        token.safeTransferFrom(address(msg.sender), address(this), _amount);
    }

    // sends XYZ token to SC
    function _transferQuoteToStorage(uint256 _amount) private {
        IERC20 token = IERC20(TokenXYZ);
        require(token.balanceOf(msg.sender) >= _amount, "Insufficient token balance");
        require(msg.sender != address(this), "Only EOA");
        token.safeTransferFrom(address(msg.sender), address(this), _amount);
    }

    // sends USDP token to SC
    function _transferBaseToStorage(uint256 _amount) private {
        IERC20 token = IERC20(USDP);
        require(token.balanceOf(msg.sender) >= _amount, "Insufficient token balance");
        require(msg.sender != address(this), "Only EOA");
        token.safeTransferFrom(address(msg.sender), address(this), _amount);
    }

    // sends USDP token to User
    function _transferBaseToUser(address _recipient, uint256 _amount) private {
        IERC20 token = IERC20(USDP);
        require(token.balanceOf(address(this)) >= _amount, "Insufficient OrderBookStorage token balance");
        token.safeTransfer(_recipient, _amount);
    }

    // sends XYZ token to User
    function _transferQuoteToUser(address _recipient, uint256 _amount) private {
        IERC20 token = IERC20(TokenXYZ);
        require(token.balanceOf(address(this)) >= _amount, "Insufficient OrderBookStorage token balance");
        token.safeTransfer(_recipient, _amount);
    }

    function _emitOrderEvent(OrderDetails memory order) private {
        emit AlterDCAStrategy(
            order.index,
            storageID,
            order.trader,
            order.interval,
            order.tokenPriceMin,
            order.tokenPriceMax,
            order.tokenAmount,
            order.buyOrder,
            order.lastSwapCount,
            order.lastSwapTime,
            order.totalSwapSum
        );
    }

    function _swap(address _tokenIn, address _tokenOut, uint256 _amountIn, uint256 _amountOutMin, address _to) private {
        require(_amountIn >= 1, "Swap: Insufficient Token In Amount");
        require(_amountOutMin >= 1, "Swap:Insufficient Token Out Minimum");
        require(_tokenIn != address(0), "Swap: tokenIn cannot be the zero address.");
        require(_tokenOut != address(0), "Swap: tokenOut cannot be the zero address.");
        require(_to != address(0), "Swap: _to cannot be the zero address.");

        IERC20(_tokenIn).approve(UNISWAP_V2_ROUTER, _amountIn);

        address[] memory path;

        path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;

        IUniswapV2Router02(UNISWAP_V2_ROUTER).swapExactTokensForTokens(
            _amountIn,
            _amountOutMin,
            path,
            _to,
            block.timestamp
        );

        // need to return a value, if successful or not and tokenOut Amount
    }

    function _resetArray() private {
        require(OrderList.length == 1, "OrderList does not equal one");
        // Reset the OrderList
        delete OrderList;
       // OrdersLength = 0;
    }
}
