// yarn deploy --network hardhat --tags DCAFactory
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

//const abi = require('../../abi/contracts/amm/UniswapV2Pair.sol/Uniswapv2Pair.json')


const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { ethers, deployments, getNamedAccounts, network } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();


  console.log("DeployerAddress: :", deployer);

/*
  const factoryContract = await ethers.getContract(`UniswapV2Factory`);
  const factoryAddress = factoryContract.address;
  console.log("Factory Pools:", factoryAddress);

  const factoryPoolLength = await factoryContract.allPairsLength();
  const length = Number(factoryPoolLength.toString());
  console.log("Factory Pools:", length);
*/

  const usdpContract = await ethers.getContract(`RubyUSDP`);
  const USDP_TOKEN_ADDRESS = usdpContract.address;

  const rubyContract = await ethers.getContract(`RubyToken`);
  const RUBY_TOKEN_ADDRESS = rubyContract.address;

  const routerContract = await ethers.getContract(`UniswapV2Router02`);
  const routerAddress = routerContract.address;



  const deployedTX = await deploy(`DCAFactory`, {
    from: deployer,
    args: [deployer, routerAddress, USDP_TOKEN_ADDRESS, RUBY_TOKEN_ADDRESS],
    log: true,
  });

  console.log("deploy address ", deployedTX.address)



  /*
      await deploy(`DCAFactory`, {
        from: deployer,
        log: true,
        proxy: {
          viaAdminContract: "RubyProxyAdmin",
          proxyContract: "OpenZeppelinTransparentProxy",
          execute: {
            methodName: "initialize",
            args: [deployer, routerAddress, USDP_TOKEN_ADDRESS, RUBY_TOKEN_ADDRESS],
          },
        },
        skipIfAlreadyDeployed: true,
  
      });
  
      */


  //each storage needs role to burn ruby 


  const burnerRole = await rubyContract.BURNER_ROLE();

  if ((await rubyContract.hasRole(burnerRole, deployedTX.address)) === false) {
    const res = await rubyContract.grantRole(burnerRole, deployedTX.address);
    await res.wait(1);
    console.log(`granted RubyToken.BURNER_ROLE to DCA Storage@${deployedTX.address}`);
  }




};


export default func;

func.tags = ["DCAFactory"];



