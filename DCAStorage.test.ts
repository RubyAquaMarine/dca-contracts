//yarn test test/limit-orders/DCAStorage.test.ts
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { deployAMM, deployNftsAndNftAdmin, deployMockTokens, createMockLPs, } from "../utilities/deployment";
import { approveTokens } from "../utilities/seeding";

import {
  advanceTimeByTimestamp,
  advanceTimeToTimestamp,
} from "../utilities";

describe("OrderBookStorage", function () {

  beforeEach(async function () {
    this.signers = await ethers.getSigners();
    this.owner = this.signers[0];
    this.alice = this.signers[1];

    // NFT
    let { rubyFreeSwapNft, rubyProfileNft, nftAdmin } = await deployNftsAndNftAdmin(this.owner.address)

    this.rubyProfileNft = rubyProfileNft;
    this.rubyFreeSwapNft = rubyFreeSwapNft;
    this.nftAdmin = nftAdmin;

    // AMM
    let { factory, ammRouter } = await deployAMM(this.owner.address, nftAdmin.address);
    this.factory = factory;
    this.router = ammRouter;

    // AMM permissions
    await this.factory.setPairCreator(this.owner.address, true);
    await this.factory.setPairCreator(this.router.address, true);


    this.mockTokenSupply = ethers.utils.parseUnits("10000000000", 18);
    this.token1liquidity = ethers.utils.parseUnits("100000", 18);
    this.token2liquidity = ethers.utils.parseUnits("500000", 18);

    this.mockTokens = await deployMockTokens(this.mockTokenSupply);
    // APPROVE FOR ADD LIQUIDITY
    await approveTokens(this.mockTokens, this.router.address, ethers.constants.MaxUint256);

    // AMM create PAIRS : addLiquidity
    await createMockLPs(
      this.router,
      this.mockTokens,
      this.token1liquidity,
      this.token2liquidity,
      this.owner.address,
    );

    this.RubyToken = await ethers.getContractFactory("RubyTokenMintable");
    this.ruby = await this.RubyToken.deploy();
    await this.ruby.deployed();

    this.mockTokens.push(this.ruby);

    this.usdp = this.mockTokens[0].address;
    this.eth = this.mockTokens[1].address;


    this.contract = await ethers.getContractFactory("DCAStorage");
    this.OrderStorage = await this.contract.deploy(this.owner.address, this.router.address, this.usdp, this.eth, this.ruby.address);
    await this.OrderStorage.deployed();

    const orderStorageAddress = this.OrderStorage.address;

    const burnerRole = await this.ruby.BURNER_ROLE();

    if ((await this.ruby.hasRole(burnerRole, orderStorageAddress)) === false) {
      let res = await this.ruby.grantRole(burnerRole, orderStorageAddress);
      await res.wait(1);
    }

    // Approve 
    await approveTokens(this.mockTokens, orderStorageAddress, ethers.constants.MaxUint256);

    // ALICE 
    for (let i = 0; i < this.mockTokens.length; i++) {
      await this.mockTokens[i].transfer(this.alice.address, ethers.utils.parseUnits("1000000", 18));
      await this.mockTokens[i].connect(this.alice).approve(orderStorageAddress, ethers.constants.MaxUint256);
    }

    /*
        await this.mockTokens[0].transfer(this.alice.address, ethers.utils.parseUnits("1000000", 18));
        await this.mockTokens[1].transfer(this.alice.address, ethers.utils.parseUnits("1000000", 18));
    
        await this.mockTokens[0].connect(this.alice).approve(orderStorageAddress, ethers.constants.MaxUint256);
        await this.mockTokens[1].connect(this.alice).approve(orderStorageAddress, ethers.constants.MaxUint256);
    */
  });

  it("SubmitDCAOrderFromFactory: reverts", async function () {
    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    // Use Alice
    await expect(this.OrderStorage.connect(this.alice).SubmitDCAOrderFromFactory(60, 1, 1, max, a, true)).to.be.revertedWith(
      "Only from FactoryAddress",
    );

  });


  it("Place BUY XYZ DCA Order and Get Order", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const balance = await this.ruby.balanceOf(this.owner.address);

    const tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const balance2 = await this.ruby.balanceOf(this.owner.address);

    expect(balance2).to.be.lt(balance);

  });

  it("Place BUY XYZ DCA Order and burn", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);
    const tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();

    await this.OrderStorage.burn();


  });

  it("Place BUY XYZ DCA Order and Delete", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[0];

    const walletb4 = await token.balanceOf(this.owner.address);


    const tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const walletAfter = await token.balanceOf(this.owner.address);


    const tx1 = await this.OrderStorage.DeleteOrder(0);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);

    const walletFinal = await token.balanceOf(this.owner.address);

    // check the token balance
    expect(walletFinal).to.equal(walletb4);

  });

  it("Place Two BUY XYZ DCA Order and Delete Both", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[0];

    const walletb4 = await token.balanceOf(this.owner.address);

    //place 3 orders
    let tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();
    tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 10, max, a, true);
    await tx.wait();
    tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 10, max, a, true);
    await tx.wait();
    tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 10, max, a, true);
    await tx.wait();
    tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 10, max, a, true);
    await tx.wait();


    expect(await this.OrderStorage.OrdersTotal()).to.equal(5);



    // delete first order placed
    let tx1 = await this.OrderStorage.DeleteOrder(0);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(4);

    tx1 = await this.OrderStorage.DeleteOrder(1);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(3);


    tx1 = await this.OrderStorage.DeleteOrder(2);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(2);


    tx1 = await this.OrderStorage.DeleteOrder(3);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(1);

    tx1 = await this.OrderStorage.DeleteOrder(4);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);


    const walletFinal = await token.balanceOf(this.owner.address);

    // check the token balance
    expect(walletFinal).to.equal(walletb4);

  });


  it("Place BUY XYZ DCA Order and Execute", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[0];
    const walletb4 = await token.balanceOf(this.owner.address);

    const tokenB = this.mockTokens[1];
    const walletb4_b = await tokenB.balanceOf(this.owner.address);


    const tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const walletAfter = await token.balanceOf(this.owner.address);


    expect(walletb4).to.be.gt(walletAfter);

    const tx1 = await this.OrderStorage.ExecuteOrders(true);// Execute Buy Orders
    await tx1.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(1);

    const walletAfter_b = await tokenB.balanceOf(this.owner.address);


    expect(walletAfter_b).to.be.gt(walletb4_b);// swapped tokenA into TokenB

  });

  it("Place SELL XYZ DCA Order and Delete", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[1];

    const walletb4 = await token.balanceOf(this.owner.address);


    const tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, false);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const walletAfter = await token.balanceOf(this.owner.address);


    const tx1 = await this.OrderStorage.DeleteOrder(0);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);

    const walletFinal = await token.balanceOf(this.owner.address);

    // check the token balance
    expect(walletFinal).to.equal(walletb4);

  });

  it("Place SELL XYZ DCA Order and Execute", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[1];

    const walletb4 = await token.balanceOf(this.owner.address);


    const tokenB = this.mockTokens[0];
    const walletb4_b = await tokenB.balanceOf(this.owner.address);


    const tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, false);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const walletAfter = await token.balanceOf(this.owner.address);


    expect(walletb4).to.be.gt(walletAfter);

    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(1);

    const walletAfter_b = await tokenB.balanceOf(this.owner.address);


    expect(walletAfter_b).to.be.gt(walletb4_b);// swapped tokenB into TokenA (tokenA increases)


  });

  it("Place BUY XYZ DCA Order and Execute 5 swaps", async function () {

    const constInterval = 719;// 

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[0];
    const walletb4 = await token.balanceOf(this.owner.address);



    const tokenB = this.mockTokens[1];
    const walletb4_b = await tokenB.balanceOf(this.owner.address);


    const tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, a, true);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const walletAfter = await token.balanceOf(this.owner.address);


    expect(walletb4).to.be.gt(walletAfter);

    // Execute 1
    const tx1 = await this.OrderStorage.ExecuteOrders(true);// Execute Buy Orders
    await tx1.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(1);


    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(true);// Execute Buy Orders
    await tx2.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(2);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(true);// Execute Buy Orders
    await tx3.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(3);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx4 = await this.OrderStorage.ExecuteOrders(true);// Execute Buy Orders
    await tx4.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(4);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    await advanceTimeByTimestamp(constInterval);
    const tx5 = await this.OrderStorage.ExecuteOrders(true);// Execute Buy Orders
    await tx5.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(5);



    expect(await this.OrderStorage.OrdersLength()).to.equal(0);// Delete the Order from DB

  });

  it("Place SELL XYZ DCA Order and Execute 5 swaps", async function () {

    const constInterval = 720;// 

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[1];

    const walletb4 = await token.balanceOf(this.owner.address);


    const tokenB = this.mockTokens[0];
    const walletb4_b = await tokenB.balanceOf(this.owner.address);


    const tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, a, false);
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);

    const walletAfter = await token.balanceOf(this.owner.address);


    expect(walletb4).to.be.gt(walletAfter);

    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(1);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx2.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(2);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx3.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(3);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx4 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx4.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(4);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx5 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx5.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(5);

    // Add delay 
    await advanceTimeByTimestamp(constInterval);
    const tx6 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx6.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(5);


    expect(await this.OrderStorage.OrdersLength()).to.equal(0);// Delete the Order from DB


  });




  it("Place BUY and SELL XYZ DCA Order and Execute swaps", async function () {

    const constInterval = 720;// 12 minutes , 5 swaps within 1 hour 

    // 60 minute

    // AMM PRICE
    let amount = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);
    // SELL
    const tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);
    // BUY
    const tx0 = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx0.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(2);

    // EXECUTE
    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    const tx11 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx11.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(2);

    // Add delay 12
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx2.wait();
    const tx22 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx22.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(4);

    // Add delay  24
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx3.wait();
    const tx33 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx33.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(6);

    // Add delay 36
    await advanceTimeByTimestamp(constInterval);
    const tx4 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx4.wait();
    const tx44 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx44.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(8);

    // Add delay 48 ( swap 5 should be the last swap)
    await advanceTimeByTimestamp(constInterval);
    const tx5 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx5.wait();


    expect(await this.OrderStorage.OrdersFilled()).to.equal(9);


    const tx55 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx55.wait();

    const tx66 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await tx66.wait();

    expect(await this.OrderStorage.OrdersFilled()).to.equal(10);

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);// Delete the Order from DB



  });

  it("Place BUY and SELL XYZ DCA Order and Execute swaps (amounts)", async function () {

    const constInterval = 720;// 12 minutes , 5 swaps within 1 hour 

    // 60 minute

    // AMM PRICE
    let amount = ethers.utils.parseUnits("9.6789", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);
    // SELL
    const tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(1);
    // BUY
    const tx0 = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx0.wait();
    expect(await this.OrderStorage.OrdersTotal()).to.equal(2);

    // EXECUTE
    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    const tx11 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx11.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(2);

    // Add delay 12
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx2.wait();
    const tx22 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx22.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(4);

    // Add delay  24
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx3.wait();
    const tx33 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx33.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(6);

    // Add delay 36
    await advanceTimeByTimestamp(constInterval);
    const tx4 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx4.wait();
    const tx44 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx44.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(8);

    // Add delay 48 ( swap 5 should be the last swap)
    await advanceTimeByTimestamp(constInterval);
    const tx5 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx5.wait();


    expect(await this.OrderStorage.OrdersFilled()).to.equal(9);


    const tx55 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx55.wait();

    const tx66 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await tx66.wait();

    expect(await this.OrderStorage.OrdersFilled()).to.equal(10);

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);// Delete the Order from DB



  });

  it("Place BUY and SELL XYZ DCA Order and Execute 10 swaps (orders)", async function () {

    const constInterval = 720;// 12 minutes , 5 swaps within 1 hour 

    // 60 minute

    // AMM PRICE
    let amount = ethers.utils.parseUnits("9.6789", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);
    // SELL
    let tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();


    expect(await this.OrderStorage.OrdersTotal()).to.equal(10);


    // EXECUTE
    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    const tx11 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx11.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(10);

    // Add delay 12
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx2.wait();
    const tx22 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx22.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(20);

    // Add delay  24
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx3.wait();
    const tx33 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx33.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(30);

    // Add delay 36
    await advanceTimeByTimestamp(constInterval);
    const tx4 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx4.wait();
    const tx44 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx44.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(40);

    // Add delay 48 ( swap 5 should be the last swap)
    await advanceTimeByTimestamp(constInterval);
    const tx5 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx5.wait();
    const tx55 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx55.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(50);

    await advanceTimeByTimestamp(constInterval);
    const tx6 = await this.OrderStorage.ExecuteOrders(false);// Execute  Orders again 
    await tx6.wait();
    const tx66 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await tx66.wait();

    // 6 orders still exist : swaps are done, but now we need to remove the orders from DB 1 at a time
    let txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();

    expect(await this.OrderStorage.OrdersFilled()).to.equal(50);






    expect(await this.OrderStorage.OrdersLength()).to.equal(0);// Delete the Order from DB



  });

  it("Place BUY and SELL XYZ DCA Order and Execute swaps (interval)", async function () {

    const constInterval = 1440;// 12 minutes , 5 swaps within 1 hour 

    // 60 minute

    // AMM PRICE
    let amount = ethers.utils.parseUnits("9.6789", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);
    // SELL
    let tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, 1, 1, max, amount, true);// orderIndex 1
    await tx.wait();


    expect(await this.OrderStorage.OrdersTotal()).to.equal(10);


    // EXECUTE
    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    const tx11 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx11.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(10);

    // Add delay 12
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx2.wait();
    const tx22 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx22.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(20);

    // Add delay  24
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx3.wait();
    const tx33 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx33.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(20);

    // 6 orders still exist : swaps are done, but now we need to remove the orders from DB 1 at a time
    let txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();
    txEnd = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders again 
    await txEnd.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);// Delete the Order from DB



  });



  it("Place BUY and SELL XYZ DCA Order and Execute swaps (hours)", async function () {

    const constInterval = 1440;// 12 minutes , 5 swaps within 1 hour 
    const hours = 2;

    // 60 minute

    // AMM PRICE
    let amount = ethers.utils.parseUnits("9.6789", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);
    // SELL
    let tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, true);// orderIndex 1
    await tx.wait();

    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, false);// orderIndex 0
    await tx.wait();

    // BUY
    tx = await this.OrderStorage.SubmitDCAOrder(constInterval, hours, 1, max, amount, true);// orderIndex 1
    await tx.wait();


    expect(await this.OrderStorage.OrdersTotal()).to.equal(10);


    // EXECUTE
    const tx1 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx1.wait();
    const tx11 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx11.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(10);

    // Add delay 12
    await advanceTimeByTimestamp(constInterval);
    const tx2 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx2.wait();
    const tx22 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx22.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(20);

    // Add delay  24
    await advanceTimeByTimestamp(constInterval);
    const tx3 = await this.OrderStorage.ExecuteOrders(false);// Execute Sell Orders
    await tx3.wait();
    const tx33 = await this.OrderStorage.ExecuteOrders(true);// Execute buy Orders
    await tx33.wait();
    expect(await this.OrderStorage.OrdersFilled()).to.equal(30);

    expect(await this.OrderStorage.OrdersLength()).to.equal(10);// Delete the Order from DB



  });

  it("Different users place two BUY XYZ DCA orders and delete both", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);

    const token = this.mockTokens[0];

    const walletb4owner = await token.balanceOf(this.owner.address);
    const walletb4alice = await token.balanceOf(this.alice.address);

    //place order by owner
    let tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();
    //place order by alice
    tx = await this.OrderStorage.connect(this.alice).SubmitDCAOrder(60, 1, 10, max, a, true);
    await tx.wait();

    expect(await this.OrderStorage.OrdersTotal()).to.equal(2);
    const walletAfterOwner = await token.balanceOf(this.owner.address);
    expect(walletAfterOwner).to.equal(walletb4owner.sub(a));
    const walletAfterAlice = await token.balanceOf(this.alice.address);
    expect(walletAfterAlice).to.equal(walletb4alice.sub(a));


    // delete first order placed
    let tx1 = await this.OrderStorage.DeleteOrder(0);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(1);

    tx1 = await this.OrderStorage.connect(this.alice).DeleteOrder(1);
    await tx1.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(0);

    const walletFinalOwner = await token.balanceOf(this.owner.address);
    const walletFinalAlice = await token.balanceOf(this.alice.address);

    // check the token balance
    expect(walletFinalOwner).to.equal(walletb4owner);
    expect(walletFinalAlice).to.equal(walletb4alice);

  });

  it("Get My Order Details ", async function () {

    // AMM PRICE
    let a = ethers.utils.parseUnits("1.0", 18);
    let max = ethers.utils.parseUnits("99999.0", 18);
    let traderAddress = this.owner.address;

    //place order by owner
    let tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, true);
    await tx.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(1);

    let orders = await this.OrderStorage.GetMyOrderDetails(traderAddress);

    expect(orders[1]).to.equal(1);

    //place order by owner
    tx = await this.OrderStorage.SubmitDCAOrder(60, 1, 1, max, a, false);
    await tx.wait();

    expect(await this.OrderStorage.OrdersLength()).to.equal(2);

    orders = await this.OrderStorage.GetMyOrderDetails(traderAddress);

    expect(orders[2]).to.equal(1);

    console.log("orders:", orders, orders.toString());

  });





  this.afterEach(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});
