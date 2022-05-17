var Web3 = require("web3");
var fs = require('fs');
const path = require('path');
var db = require('./db/db.js');
const mongoose = require('mongoose');
var Tx = require('ethereumjs-tx');
var cronJob = require('cron').CronJob;
const config = require('./config.json');
const axios = require('axios');
const transactionDetails = mongoose.model('transactionDetails');

const CHAIN_ID_BSC = config.chainIdBSC;
const GAS_LIMIT = config.GAS_LIMIT;

const degenBridgeAbi = require('./abis/DegenBridge.json');
const degenBSCAbi = require('./abis/BscDegen.json');
const degenBSCAbi_1 = require('./abis/BscDegen_1.json');
const addTokenAbi = require('./abis/custom_token_abi.json');

const OWNER_ADDRESS = config.OWNER_ADDRESS;
const pKey = config.pKey;

const CROSS_BRIDGE_ADDRESS = config.degenBSCBridge;
const DEGEN_ADDRESS = config.degenBSCContractAddress;

const web3 = new Web3(new Web3.providers.HttpProvider(config.connectionURL));
const web3Bsc = new Web3(new Web3.providers.HttpProvider(config.connectionURL1));

const CROSS_BRIDGE_INSTANCE = new web3Bsc.eth.Contract(degenBridgeAbi, config.degenBSCBridge);
const BRIDGE_INSTANCE = new web3.eth.Contract(degenBridgeAbi, config.degenETHBridge);
const DEGEN_INSTANCE = new web3Bsc.eth.Contract(degenBSCAbi, config.degenBSCContractAddress);
const DEGEN_INSTANCE_1 = new web3Bsc.eth.Contract(degenBSCAbi_1, config.degenBSCContractAddress_1);

let Ordertype = [2,1,2,1];


var Bscnonce = 0;
async function  initBscNonce(){
    var _nonce = await web3Bsc.eth.getTransactionCount(OWNER_ADDRESS,'pending');
    if(_nonce > Bscnonce){
        Bscnonce = _nonce;
        console.log("Bscnonce",Bscnonce);
    }
}


var cronJ1 = new cronJob("*/1 * * * *", async function () {
  checkPending()
}, undefined, true, "GMT");


async function checkPending() {
  fs.readFile(path.resolve(__dirname, 'ethBlock.json'), async (err, blockData) => {
      if (err) {
          console.log(err);
          return;
      }

      blockData = JSON.parse(blockData);
      let lastcheckBlock = blockData["lastblock"];
      const latest = await web3.eth.getBlockNumber();
      console.log(lastcheckBlock,latest)
      blockData["lastblock"] = latest;

      BRIDGE_INSTANCE.getPastEvents({},
        {
            fromBlock: lastcheckBlock,
            toBlock: latest // You can also specify 'latest'          
        })
        .then(async function (resp) {
            for (let i = 0; i < resp.length; i++) {
                if (resp[i].event === "SwapRequest") {
                    console.log("SwapRequest emitted");
                    let isAlreadyProcessed = false;
                    if(resp[i].returnValues.nonce) {
                        isAlreadyProcessed = await CROSS_BRIDGE_INSTANCE.methods.nonceProcessed(resp[i].returnValues.nonce).call();
                    }
                    !isAlreadyProcessed && SwapRequest(resp[i])
                }
            }
            fs.writeFile(path.resolve(__dirname, './ethBlock.json'), JSON.stringify(blockData), (err) => {
                if (err);
                console.log(err);
            });
        })
        .catch((err) => console.error(err));
  });
}


const getRawTransactionApp = function (_address, _nonce, _gasPrice, _gasLimit, _to, _value, _data) {
    return {
        nonce: web3Bsc.utils.toHex(_nonce),
        gasPrice: _gasPrice === null ? '0x098bca5a00' : web3Bsc.utils.toHex(_gasPrice),
        gasLimit: _gasLimit === null ? '0x96ed' : web3Bsc.utils.toHex(_gasLimit),
        to: _to,
        value: _value === null ? '0x00' : web3Bsc.utils.toHex(_value),
        data: _data === null ? '' : _data,
        chainId: CHAIN_ID_BSC
    }
}


async function SwapRequest(decode){
    await initBscNonce();
    let tokenB = decode.returnValues.tokenB;
    let user = decode.returnValues.user;
    var amount = decode.returnValues.amount;
    let crossOrderType = decode.returnValues.crossOrderType;
    let id = decode.returnValues.nonce;
    let dexId = decode.returnValues.dexId;       // destination dex id (bsc)
    // let distribution = decode.returnValues.distribution;

    let USDT_BSC = config.USDTBEP20Address;

    const path = [USDT_BSC,tokenB];

    var finalAmount = amount;

    if(path[0]===path[1]) {
        finalAmount = amount;
    }
    else {
        try {
            var bestQuote = await DEGEN_INSTANCE_1.methods.getBestQuote(path, amount, Ordertype[crossOrderType]).call();
            console.log('bestQuote', bestQuote);
            finalAmount = bestQuote[1];
        }
        catch(err) {
            console.log("Error in fetching final amount", err)
        }
    }
    
    try {
        var deadlineLimit = await DEGEN_INSTANCE.methods.getDeadlineLimit().call();
        console.log('deadlineLimit', deadlineLimit);
    }
    catch {
        var deadlineLimit = 1200;      // 20 minutes
    }

    var deadline = parseInt(Date.now()/1000) + parseInt(deadlineLimit);

    console.log('arguments to bsc claim token behalf',
        path, user, amount, crossOrderType, id, dexId, deadline
    );
    
    var nominator = web3.utils.toBN(1e12);
    amount =  web3.utils.toBN(amount).mul(nominator);
    
    // check balance - if less and equal amount that proceed to claim otherwise call vaultTransfer
    let bal = null;
    let request = await axios.get('http://localhost:3002/getBal?network=eth');
    if(request.status == 200){
        bal = request.data.response;

        bal = Web3.utils.toBN(bal);
        amount = Web3.utils.toBN(amount);
    
        if(amount.lte(bal)){
            var encodeABI = CROSS_BRIDGE_INSTANCE.methods.claimTokenBehalf(path, user, amount, crossOrderType, id, dexId, deadline).encodeABI();

            var GAS_LIMIT = await CROSS_BRIDGE_INSTANCE.methods.claimTokenBehalf(path, user, amount, crossOrderType, id, dexId, deadline).estimateGas({from: OWNER_ADDRESS}); 
        
            console.log(GAS_LIMIT);
        
            console.log("2");
        
            var gasPrice = await web3Bsc.eth.getGasPrice();
        
            var rawData = getRawTransactionApp(
                OWNER_ADDRESS,
                Bscnonce,
                gasPrice,
                (GAS_LIMIT+20000).toString(),
                CROSS_BRIDGE_ADDRESS,
                null,
                encodeABI
            );
        
            console.log("3", rawData);
        
            var tx = new Tx(rawData);
            let privateKey = new Buffer.from(pKey, 'hex');
            console.log("4");
        
            tx.sign(privateKey);
            var serializedTx = tx.serialize();
            console.log('serializedTx', serializedTx.toString('hex'))
            console.log("5");
        
            let firstToken = 'INVALID TOKEN'
            let secondToken = 'INVALID TOKEN'
            let tokenDecimals = 18
        
                try {
                    const firstTokenContractInstance = new web3Bsc.eth.Contract(addTokenAbi, path[0]);
                    firstToken = await firstTokenContractInstance.methods.symbol().call();
                    console.log('firstToken', firstToken);
        
                    const secondTokenContractInstance = new web3Bsc.eth.Contract(addTokenAbi, path[1]);
                    secondToken = await secondTokenContractInstance.methods.symbol().call();
                    console.log('secondToken', secondToken);
                }
                catch (err) {
                    console.log('Error in fetching token symbol')
                }
        
                try {
                    const tokenContractInstance = new web3Bsc.eth.Contract(addTokenAbi, tokenB);
                    tokenDecimals = await tokenContractInstance.methods.decimals().call();
                    console.log('tokenDecimals', tokenDecimals, tokenB);
                }
                catch (err) {
                    console.log('Error in fetching token decimals')
                }
                
            // changing web3 instance
            web3Bsc.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async function (error, hash) {
                    let obj = {
                        token: `${firstToken}/${secondToken}`,          // receiving end token
                        amount: finalAmount/Math.pow(10, tokenDecimals),     // receiving tokens
                        userAddress: user.toLowerCase(),
                        chain: config.fromChainBSC,
                        token_image: null,
                        time : new Date().toISOString(),
                        transactionType: '2',
                    }
                    if (error) { 
                        obj['transactionHash'] = null;
                        obj['transactionStatus'] = 'Failure';
                        console.log("Tx Error : ", error); 
                    } else {
                        obj['transactionHash'] = hash;
                        obj['transactionStatus'] = 'Success';
                        obj['crossChainTrx'] = decode.transactionHash;
                        console.log("Tx Success : ", hash); 
                    }
                    const data = new transactionDetails(obj);
                    try {
                        await data.save();
                        console.log("Transaction details Saved in db Successfully")
                    }
                    catch (err) {
                        console.log("Error in saving Transaction details in DB, ", err)
                    };
            })
            console.log("6");
        } else {
            let request = await axios({
                method: 'post',
                url: 'http://localhost:3002/vaultTransfer',
                data: {
                    network: 'BSC',
                    amount: amount
                }
            });
    
            if(request.status == 200){
                console.log('Difference amount adjusted on vault.');
            } else {
                console.log('Something went wrong with the vaultTransfer API.')
            }            
        }
    } else {
        console.log('Failed to fetch balance from ETH network')
    }
}


cronJ1.start();