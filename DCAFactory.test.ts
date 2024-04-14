//yarn test test/limit-orders/DCAFactory.test.ts
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { deployAMM, deployNftsAndNftAdmin, deployMockTokens, createMockLPs, } from "../utilities/deployment";
import { approveTokens } from "../utilities/seeding";
import { advanceTimeByTimestamp, advanceTimeToTimestamp } from "../utilities";

describe("DCA Factory", function () {

  beforeEach(async function () {
    this.signers = await ethers.getSigners();
    this.owner = this.signers[0];
    this.alice = this.signers[1];

    // console.log(" User Admin:", this.owner.address)
    // console.log(" User Alice:", this.alice.address)

    // NFT
    let { rubyFreeSwapNft, rubyProfileNft, nftAdmin } = await deployNftsAndNftAdmin(this.owner.address)
    this.rubyProfileNft = rubyProfileNft;
    this.rubyFreeSwapNft = rubyFreeSwapNft;
    this.nftAdmin = nftAdmin;

    await this.rubyProfileNft.setMinter(this.owner.address, true);
    await this.rubyProfileNft.mint(this.owner.address);

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

    this.usdpContract = this.mockTokens[0];

    await approveTokens(this.mockTokens, this.router.address, ethers.constants.MaxUint256);
    const blockNumber = await ethers.provider.getBlockNumber();
    const blockData = await ethers.provider.getBlock(blockNumber);
    const deadline = ethers.BigNumber.from(blockData.timestamp + 23600);

    const res = await ammRouter.addLiquidity(
      this.ruby.address,
      this.usdp,
      this.token1liquidity,
      this.token2liquidity,
      this.token1liquidity,
      this.token2liquidity,
      this.owner.address,
      deadline,
    );
    await res.wait(1);

    this.contract = await ethers.getContractFactory("DCAFactory");

    this.OrderStorage = await this.contract.deploy(this.owner.address, this.router.address, this.usdp, this.ruby.address);

    await this.OrderStorage.deployed();

    const orderStorageAddress = this.OrderStorage.address;

    const nftAddress = await this.OrderStorage.setNftAddress(this.rubyProfileNft.address);

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

  });

  it("Turn off trading", async function () {

    expect(await this.OrderStorage.TradingEnabled()).to.be.equal(true)

    await this.OrderStorage.TradingCondition(false);

    expect(await this.OrderStorage.TradingEnabled()).to.be.equal(false)

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // Use Alice
    await expect(this.OrderStorage.connect(this.alice).SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true)).to.be.revertedWith(
      "Trading is off",
    );

  });

  it("Turn on trading", async function () {

    expect(await this.OrderStorage.TradingEnabled()).to.be.equal(true)

    await this.OrderStorage.TradingCondition(false);

    expect(await this.OrderStorage.TradingEnabled()).to.be.equal(false)

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // Use Alice
    await expect(this.OrderStorage.connect(this.alice).SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true)).to.be.revertedWith(
      "Trading is off",
    );

    // turn trading on 
    await this.OrderStorage.TradingCondition(true);

    expect(await this.OrderStorage.TradingEnabled()).to.be.equal(true);

    //  let tx = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    let tx = await this.OrderStorage.connect(this.alice).SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await tx.wait();

    //  expect(await this.OrderStorage.GetOrderLength(1)).to.be.equal(1);


  });


  it("Change MAX_ORDERS by an increase 2x", async function () {

    const mult = 2;

    const maxOrders = await this.OrderStorage.MAX_ORDERS();

    const changeOrders = await this.OrderStorage.ChangeMaxOrders(maxOrders.mul(mult))

    expect(await this.OrderStorage.MAX_ORDERS()).to.be.equal(maxOrders.mul(mult))

  });


  it("Change Entry Fee", async function () {

    const mult = 2;

    const fee = await this.OrderStorage.EntryFee();

    const changeFee = await this.OrderStorage.ChangeEntryFee(fee.mul(mult))

    await changeFee.wait();

    expect(await this.OrderStorage.EntryFee()).to.be.equal(fee.mul(mult))

  });

  it("Change Admin Relayer", async function () {

    const oldRelayer = await this.OrderStorage.Relayer();

    const tx = await this.OrderStorage.ChangeRelayer(this.alice.address);

    await tx.wait();

    const newRelayer = await this.OrderStorage.Relayer();

    //  console.log(` old ${oldRelayer} new ${newRelayer}`)

    expect(oldRelayer).to.not.equal(newRelayer)

    expect(newRelayer).to.equal(this.alice.address)


  });

  it("Burn Ruby", async function () {

    const maxStorageIds = await this.OrderStorage.StorageID();
    const relayer = await this.OrderStorage.Relayer();
    const router = await this.OrderStorage.Router();

    console.log(` -- USDP ${this.usdp} RUBY ${this.ruby.address} `)


  });


  it("GetStorageAddressUsingToken ", async function () {

    const test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    expect(await this.OrderStorage.StorageID()).to.be.equal(1)

  });


  it("GetStorageAddressUsingIndex ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    test = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    expect(test).to.equal('0x55C9DCD6128e7d7e7e136d78e533C01F0cB2ef77')

  });

  it("GetTokenXYZUsingIndex ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    test = await this.OrderStorage.GetTokenXYZUsingIndex(_storageIndex);

    expect(test).to.equal('0x95401dc811bb5740090279Ba06cfA8fcF6113778')

  });

  it("GetOrderLength ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    test = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(test).to.equal(0)

  });




  it("SubmitDCAOrder ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);


    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(1)

  });

  it("SubmitDCAOrder : user has NFT ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);

    const beforeSubmit = await this.ruby.balanceOf(this.owner.address);


    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    const afterSubmit = await this.ruby.balanceOf(this.owner.address);

    // USER HAS NFT : NO Fee will be applied
    const fee = await this.OrderStorage.EntryFee();

    expect(afterSubmit).to.be.equal(beforeSubmit);

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(1)

  });

  it("SubmitDCAOrder : user doesn't have NFT ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);

    const beforeSubmit = await this.ruby.connect(this.alice).balanceOf(this.alice.address);

    test = await this.OrderStorage.connect(this.alice).SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    const afterSubmit = await this.ruby.connect(this.alice).balanceOf(this.alice.address);

    const fee = await this.OrderStorage.EntryFee();

    expect(afterSubmit).to.be.equal(beforeSubmit.sub(fee));

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(1)

  });

  it("SubmitDCAOrder and OrderDelete ", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);


    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(1)

    test = await this.OrderStorage.DeleteOrder(_storageIndex, 0);

    await test.wait();

    const value1 = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(value1).to.equal(0)

  });

  it("SubmitDCAOrder and OrderDelete after 1 swap out of 2", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    const usdpBalanceBefore = await this.usdpContract.balanceOf(this.owner.address);

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);

    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 1800, 1, 1, max, a, true);

    await test.wait();

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(1)

    // Execute 1
    const tx1 = await this.OrderStorage.ExecuteOrders(_storageIndex, true);// Execute Buy Orders
    await tx1.wait();

    test = await this.OrderStorage.DeleteOrder(_storageIndex, 0);

    await test.wait();

    const usdpBalanceAfter = await this.usdpContract.balanceOf(this.owner.address);
    expect(usdpBalanceBefore.sub(usdpBalanceAfter)).to.be.equal(a.div(2));
    const value1 = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(value1).to.equal(0)

  });


  it("SubmitDCAOrder and Auto OrderDelete after 2/2 Swaps", async function () {
    const constInterval = 1800;// 

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let investAmount = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    const usdpBalanceBefore = await this.usdpContract.balanceOf(this.owner.address);

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);

    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, constInterval, 1, 1, max, investAmount, true);

    await test.wait();

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(1)
    
    // Execute 1
    const tx1 = await this.OrderStorage.ExecuteOrders(_storageIndex, true);// Execute Buy Orders
    await tx1.wait();

    // Add delay 
    await advanceTimeByTimestamp(constInterval);

    // Execute 2
    const tx2 = await this.OrderStorage.ExecuteOrders(_storageIndex, true);// Execute Buy Orders
    await tx2.wait();

    // order is removed automatically once all swaps are completed

    const usdpBalanceAfter = await this.usdpContract.balanceOf(this.owner.address);
    expect(usdpBalanceBefore.sub(usdpBalanceAfter)).to.be.equal(investAmount);

    const value1 = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(value1).to.equal(0)
    

  });

  it("SubmitDCAOrder and OrderDelete with alice", async function () {
    const maxStorageIds = await this.OrderStorage.StorageID();

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    // get address with index 

    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    //  console.log(" Storage Address", storageAddress)

    // Approve 
    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);


    test = await this.OrderStorage.connect(this.alice).SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    test = await this.OrderStorage.connect(this.alice).SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    const valueO = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(valueO).to.equal(2)

    test = await this.OrderStorage.connect(this.alice).DeleteOrder(_storageIndex, 0);

    await test.wait();

    test = await this.OrderStorage.connect(this.alice).DeleteOrder(_storageIndex, 1);

    await test.wait();

    const value1 = await this.OrderStorage.GetOrderLength(_storageIndex);

    //  console.log(" Order Deleted ", value1.toString())

    expect(value1).to.equal(0)



  });

  it("Revert GetAllOrders with Insufficient order list length", async function () {

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    await expect(this.OrderStorage.GetAllOrders(_storageIndex, this.owner.address)).to.be.revertedWith(
      "Insufficient order list length",
    );


  });

  it("SubmitDCAOrder and Get Order Details ", async function () {

    let a = ethers.utils.parseUnits("1.0", 18);

    let max = ethers.utils.parseUnits("99999.0", 18);

    let test = await this.OrderStorage.GetStorageAddressUsingToken(this.ruby.address)

    await test.wait();

    const _storageIndex = await this.OrderStorage.StorageID();

    // get address with index 
    const storageAddress = await this.OrderStorage.GetStorageAddressUsingIndex(_storageIndex);

    await approveTokens(this.mockTokens, storageAddress, ethers.constants.MaxUint256);

    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();

    test = await this.OrderStorage.SubmitDCAOrder(this.ruby.address, 60, 1, 1, max, a, true);

    await test.wait();


    const value1 = await this.OrderStorage.GetOrderLength(_storageIndex);

    expect(value1).to.equal(3)

    let orderDetails = await this.OrderStorage.GetAllOrders(_storageIndex, this.owner.address);

    // console.log("  orders", orderDetails, orderDetails.toString());

    expect(orderDetails.length).to.equal(3)

    let orderDetailsAlice = await this.OrderStorage.GetAllOrders(_storageIndex, this.alice.address);

    // console.log("  orders", orderDetailsAlice, orderDetailsAlice.toString());

    expect(orderDetailsAlice.length).to.equal(0);

    // Get the first order details
    let orderStruc = await this.OrderStorage.GetOrderDetails(_storageIndex, 0);

    console.log("  orderStruc: ", orderStruc.toString());

    expect(orderStruc.trader).to.equal(this.owner.address);


  });

  this.afterEach(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});
