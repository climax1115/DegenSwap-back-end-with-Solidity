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

const CHAIN_ID_ETH = config.chainIdETH;
const GAS_LIMIT = config.GAS_LIMIT;

const degenBridgeAbi = require('./abis/DegenBridge.json');
const degenETHAbi = require("./abis/EthDegen.json");
const degenETHAbi_1 = require("./abis/EthDegen_1.json");
const addTokenAbi = require('./abis/custom_token_abi.json');

const OWNER_ADDRESS = config.OWNER_ADDRESS;
const pKey = config.pKey;

const DEGEN_ADDRESS = config.degenETHContractAddress;
const CROSS_SWAP_ADDRESS = config.degenETHBridge;

const web3 = new Web3(new Web3.providers.HttpProvider(config.connectionURL1));
const web3Eth = new Web3(new Web3.providers.HttpProvider(config.connectionURL));

const SWAP_INSTANCE = new web3.eth.Contract(degenBridgeAbi, config.degenBSCBridge);
const CROSS_SWAP_INSTANCE = new web3Eth.eth.Contract(degenBridgeAbi, config.degenETHBridge);
const DEGEN_INSTANCE = new web3Eth.eth.Contract(degenETHAbi, config.degenETHContractAddress);
const DEGEN_INSTANCE_1 = new web3Eth.eth.Contract(degenETHAbi_1, config.degenETHContractAddress_1);

let Ordertype = [2,1,2,1];


var Ethnonce = 0;
async function  initEthNonce(){
    console.log('else');
    var _nonce = await web3Eth.eth.getTransactionCount(OWNER_ADDRESS,'pending');
    console.log(_nonce,'qeqweqweqew');
    if(_nonce > Ethnonce){
        console.log('if');
        Ethnonce = _nonce;
        console.log("Ethnonce",Ethnonce);
    }
    console.log(Ethnonce,'Ethnonce');
   
}
 

var cronJ1 = new cronJob("*/1 * * * *", async function () {
    checkPending()
}, undefined, true, "GMT");


async function checkPending() {
    fs.readFile(path.resolve(__dirname, 'bscBlock.json'), async (err, blockData) => {
        if (err) {
            console.log(err);
            return;
        }

        blockData = JSON.parse(blockData);
        let lastcheckBlock = blockData["lastblock"];
        const latest = await web3.eth.getBlockNumber();
        console.log(lastcheckBlock,latest)
        blockData["lastblock"] = latest;

        SWAP_INSTANCE.getPastEvents({},
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
                        isAlreadyProcessed = await CROSS_SWAP_INSTANCE.methods.nonceProcessed(resp[i].returnValues.nonce).call();
                    }
                    !isAlreadyProcessed && SwapRequest(resp[i])
                }
            }
            fs.writeFile(path.resolve(__dirname, './bscBlock.json'), JSON.stringify(blockData), (err) => {
                if (err);
                console.log(err);
            });
        })
        .catch((err) => console.error(err));
    });
}


const getRawTransactionApp = function (_address, _nonce, _gasPrice, _gasLimit, _to, _value, _data) {
    return {
        nonce: web3Eth.utils.toHex(_nonce),
        gasPrice: _gasPrice === null ? '0x098bca5a00' : web3Eth.utils.toHex(_gasPrice),
        gasLimit: _gasLimit === null ? '0x96ed' : web3Eth.utils.toHex(_gasLimit),
        to: _to,
        value: _value === null ? '0x00' : web3Eth.utils.toHex(_value),
        data: _data === null ? '' : _data,
        chainId: CHAIN_ID_ETH
    }
}


async function SwapRequest(resp){
    await initEthNonce();
    const tokenB = resp.returnValues.tokenB;
    const user = resp.returnValues.user;
    var amount = resp.returnValues.amount;
    const crossOrderType = resp.returnValues.crossOrderType;
    const id = resp.returnValues.nonce;
    let dexId = resp.returnValues.dexId;       // destination dex id (eth)
    //let distribution = resp.returnValues.distribution;

    let USDT_ETH = config.USDTERC20Address;

    const path = [USDT_ETH,tokenB];

    console.log(path,'asfsdas');

    
    var flagStatus = 0;

    var finalAmount = amount;

    if(path[0]===path[1]) {
        finalAmount = amount;
    }
    else {
        try {
            var bestQuote = await DEGEN_INSTANCE_1.methods.getBestQuote(path, amount, Ordertype[crossOrderType], flagStatus).call();
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
    
    amount = parseInt(amount / 1e12);



    // check balance - if less and equal amount that proceed to claim otherwise call vaultTransfer
    let bal = null;
    let request = await axios.get('http://localhost:3002/getBal?network=BSC');
    if(request.status == 200){
        bal = request.data.response;

        bal = Web3.utils.toBN(bal);
        amount = Web3.utils.toBN(amount);
 
        if(amount.lte(bal)){

            var encodeABI = CROSS_SWAP_INSTANCE.methods.claimTokenBehalf(path, user, amount, crossOrderType, id, dexId, deadline).encodeABI();
        
            var GAS_LIMIT = await CROSS_SWAP_INSTANCE.methods.claimTokenBehalf(path, user, amount, crossOrderType, id, dexId, deadline).estimateGas({from: OWNER_ADDRESS}); 
        
            console.log(GAS_LIMIT);
        
            console.log("a");
        
            var gasPrice = await web3Eth.eth.getGasPrice();
        
            console.log('gasPrice', gasPrice)
        
            var rawData = await getRawTransactionApp(
                OWNER_ADDRESS,
                Ethnonce,
                gasPrice,
                (GAS_LIMIT+20000).toString(),
                CROSS_SWAP_ADDRESS,
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
                const firstTokenContractInstance = new web3Eth.eth.Contract(addTokenAbi, path[0]);
                firstToken = await firstTokenContractInstance.methods.symbol().call();
                console.log('firstToken', firstToken);
        
                const secondTokenContractInstance = new web3Eth.eth.Contract(addTokenAbi, path[1]);
                secondToken = await secondTokenContractInstance.methods.symbol().call();
                console.log('secondToken', secondToken);
            }
            catch (err) {
                console.log('Error in fetching token symbol')
            }
        
            try {
                const tokenContractInstance = new web3Eth.eth.Contract(addTokenAbi, tokenB);
                tokenDecimals = await tokenContractInstance.methods.decimals().call();
                console.log('tokenDecimals', tokenDecimals, tokenB);
            }
            catch (err) {
                console.log('Error in fetching token decimals')
            }
        
            // changing web3 instance
            web3Eth.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async function (error, hash) {
                let obj = {
                    token: `${firstToken}/${secondToken}`,          // receiving end token
                    amount: finalAmount/Math.pow(10, tokenDecimals),     // receiving tokens
                    userAddress: user.toLowerCase(),
                    chain: config.fromChainETH,
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
                    obj['crossChainTrx'] = resp.transactionHash;
                    console.log("Tx Success : ", hash)
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
                    network: 'ETH',
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
        console.log('Failed to fetch balance from BSC network')
    }
    
}


cronJ1.start();