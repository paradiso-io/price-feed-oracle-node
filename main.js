require('dotenv').config()
const config = require('config')
const Web3 = require('web3');
const HDWalletProvider = require('@truffle/hdwallet-provider')
const exchangeHelper = require('./helpers/readPrice')
const multipricefeedConfig = config.get("contracts.multipricefeed")
const MultiPriceFeedABI = require('./abi/MultiPriceFeedOracle.json')
const Signer = require('./oracles/signPriceData')
const chainIdList = Object.keys(multipricefeedConfig)
const contractMap = {}  //contract list based on chain id
chainIdList.forEach(c => contractMap[c] = multipricefeedConfig[c])
//chainId => {web3, [contract object, token list, description]}
const priceFeedInfoMap = {}
console.log(contractMap)
async function main() {
    //reading price feed info
    for(var i = 0; i < chainIdList.length; i++) {
        let chainId = chainIdList[i]
        if (!priceFeedInfoMap[chainId]) {
            let rpc = config.rpc[chainIdList].http
            let web3 = new Web3(new HDWalletProvider(process.env.SUBMITTER_KEY, rpc))
            priceFeedInfoMap[chainId] = {}
            priceFeedInfoMap[chainId].web3 = web3
            priceFeedInfoMap[chainId].contracts = []
            priceFeedInfoMap[chainId].tokens = [] //array of array
            priceFeedInfoMap[chainId].descriptions = []
            for(var j = 0; j < contractMap[chainId].length; j++) {
                console.log('contractMap[chainId][j]', contractMap[chainId][j])
                let ct = await new web3.eth.Contract(MultiPriceFeedABI, contractMap[chainId][j])
                priceFeedInfoMap[chainId].contracts.push(ct)
                priceFeedInfoMap[chainId].tokens.push((await ct.methods.getTokenList().call()))
                priceFeedInfoMap[chainId].descriptions.push((await ct.methods.description().call()))
            }
        }
    }
    console.log('start', new Date())
    let priceMap = await exchangeHelper.readPrices()
    console.log(priceMap)

    for(var i = 0; i < chainIdList.length; i++) {
        let chainId = chainIdList[i]
        let priceFeedInfo = priceFeedInfoMap[chainId]
        for(var j = 0; j < contractMap[chainId].length; j++) {
            let ct = priceFeedInfo.contracts[j]
            let account = await priceFeedInfo.web3.eth.getAccounts()
            account = account[0]
            console.log(account)
            let tokens = priceFeedInfo.tokens[j]
            let description = priceFeedInfo.descriptions[j]
            //collect token price from price map
            let prices = tokens.map(t => priceMap[t])
            let latestRoundInfo = await ct.methods.latestRoundInfo().call()
            let currentRound = parseInt(latestRoundInfo.roundId)
            let nextRound = currentRound + 1
            let updatedAt = parseInt(latestRoundInfo.updatedAt)
            let now = Math.floor(Date.now()/1000)
            updatedAt = now > updatedAt? now: updatedAt
            let deadline = updatedAt + 200//valid til 200s
            
            console.log('prices', prices)
            let sigs = Signer.signPriceData(nextRound, ct.options.address, prices, deadline, tokens, description)
            let r = sigs.map(e => e.r)
            let s = sigs.map(e => e.s)
            let v = sigs.map(e => e.v)

            console.log('submitting')
            await ct.methods.submit(nextRound, prices, deadline, r, s, v).send({from: account, gas: 2000000, gasPrice: 20000000000})
            console.log('success')
        }
    }

    console.log('end', new Date())
}

setInterval(async () => {
    await main()
}, 300000)  //5 minute period
