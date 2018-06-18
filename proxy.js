"use strict";
const cluster = require('cluster');
const net = require('net');
const tls = require('tls');
const http = require('http');
const moment = require('moment');
const fs = require('fs');
const async = require('async');
const uuidV4 = require('uuid/v4');
const support = require('./lib/support.js')();
global.config = require('./config.json');

const PROXY_VERSION = "0.1.6";

/*
 General file design/where to find things.

 Internal Variables
 IPC Registry
 Combined Functions
 Pool Definition
 Master Functions
 Miner Definition
 Slave Functions
 API Calls (Master-Only)
 System Init

 */
let debug = {
    pool: require('debug')('pool'),
    diff: require('debug')('diff'),
    blocks: require('debug')('blocks'),
    shares: require('debug')('shares'),
    miners: require('debug')('miners'),
    workers: require('debug')('workers'),
    balancer: require('debug')('balancer'),
    misc: require('debug')('misc')
};
global.threadName = '';
let nonceCheck = new RegExp("^[0-9a-f]{8}$");
let activePorts = [];
let httpResponse = ' 200 OK\nContent-Type: text/plain\nContent-Length: 19\n\nMining Proxy Online';
let activeMiners = {};
let activeCoins = {};
let bans = {};
let activePools = {};
let activeWorkers = {};
let defaultPools = {};
let accessControl = {};
let lastAccessControlLoadTime = null;
let masterStats = {shares: 0, blocks: 0, hashes: 0};

// IPC Registry
function masterMessageHandler(worker, message, handle) {
    if (typeof message !== 'undefined' && 'type' in message){
        switch (message.type) {
            case 'blockFind':
            case 'shareFind':
                if (message.host in activePools){
                    activePools[message.host].sendShare(worker, message.data);
                }
                break;
            case 'needPoolState':
                worker.send({
                    type: 'poolState',
                    data: Object.keys(activePools)
                });
                for (let hostname in activePools){
                    if (activePools.hasOwnProperty(hostname)){
                        if (!is_active_pool(hostname)) continue;
                        let pool = activePools[hostname];
                        worker.send({
                            host: hostname,
                            type: 'newBlockTemplate',
                            data: pool.coinFuncs.getMasterJob(pool, worker.id)
                        });
                    }
                }
                break;
            case 'workerStats':
                activeWorkers[worker.id][message.minerID] = message.data;
                break;
        }
    }
}

function slaveMessageHandler(message) {
    switch (message.type) {
        case 'newBlockTemplate':
            if (message.host in activePools){
                if(activePools[message.host].activeBlocktemplate){
                    debug.workers(`Received a new block template for ${message.host} and have one in cache.  Storing`);
                    activePools[message.host].pastBlockTemplates.enq(activePools[message.host].activeBlocktemplate);
                } else {
                    debug.workers(`Received a new block template for ${message.host} do not have one in cache.`);
                }
                activePools[message.host].activeBlocktemplate = new activePools[message.host].coinFuncs.BlockTemplate(message.data);
                for (let miner in activeMiners){
                    if (activeMiners.hasOwnProperty(miner)){
                        let realMiner = activeMiners[miner];
                        if (realMiner.pool === message.host){
                            realMiner.messageSender('job', realMiner.getJob(realMiner, activePools[message.host].activeBlocktemplate));
                        }
                    }
                }
            }
            break;
        case 'poolState':
            message.data.forEach(function(hostname){
                if(!(hostname in activePools)){
                    global.config.pools.forEach(function(poolData){
                        if (!poolData.coin) poolData.coin = "xmr";
                        if (hostname === poolData.hostname){
                            activePools[hostname] = new Pool(poolData);
                        }
                    });
                }
            });
            break;
        case 'changePool':
            if (activeMiners.hasOwnProperty(message.worker) && activePools.hasOwnProperty(message.pool)){
                activeMiners[message.worker].pool = message.pool;
                activeMiners[message.worker].messageSender('job',
                    activeMiners[message.worker].getJob(activeMiners[message.worker], activePools[message.pool].activeBlocktemplate, true));
            }
            break;
        case 'disablePool':
            if (activePools.hasOwnProperty(message.pool)){
                activePools[message.pool].active = false;
                checkActivePools();
            }
            break;
        case 'enablePool':
            if (activePools.hasOwnProperty(message.pool)){
                activePools[message.pool].active = true;
                process.send({type: 'needPoolState'});
            }
            break;
    }
}

// Combined Functions
function readConfig() {
    let local_conf = JSON.parse(fs.readFileSync('config.json'));
    if (typeof global.config === 'undefined') {
        global.config = {};
    }
    for (let key in local_conf) {
        if (local_conf.hasOwnProperty(key) && (typeof global.config[key] === 'undefined' || global.config[key] !== local_conf[key])) {
            global.config[key] = local_conf[key];
        }
    }
    if (!cluster.isMaster) {
        activatePorts();
    }
}

// Pool Definition
function Pool(poolData){
    /*
    Pool data is the following:
     {
     "hostname": "pool.supportxmr.com",
     "port": 7777,
     "ssl": false,
     "share": 80,
     "username": "",
     "password": "",
     "keepAlive": true,
     "coin": "xmr"
     }
     Client Data format:
     {
        "method":"submit",
        "params":{
            "id":"12e168f2-db42-4eea-b56a-f1e7d57f94c9",
            "job_id":"/4FIQEI/Qq++EzzH1e03oTrWF5Ed",
            "nonce":"9e008000",
            "result":"4eee0b966418fdc3ec1a684322715e65765554f11ff8f7fed3f75ac45ef20300"
        },
        "id":1
     }
     */
    this.hostname = poolData.hostname;
    this.port = poolData.port;
    this.ssl = poolData.ssl;
    this.share = poolData.share;
    this.username = poolData.username;
    this.password = poolData.password;
    this.keepAlive = poolData.keepAlive;
    this.default = poolData.default;
    this.devPool = poolData.hasOwnProperty('devPool') && poolData.devPool === true;
    this.coin = poolData.coin;
    this.pastBlockTemplates = support.circularBuffer(4);
    this.coinFuncs = require(`./lib/${this.coin}.js`)();
    this.activeBlocktemplate = null;
    this.active = true;
    this.sendId = 1;
    this.sendLog = {};
    this.poolJobs = {};
    this.socket = null;
    this.allowSelfSignedSSL = true;
    // Partial checks for people whom havn't upgraded yet
    if (poolData.hasOwnProperty('allowSelfSignedSSL')){
        this.allowSelfSignedSSL = !poolData.allowSelfSignedSSL;
    }
    this.algo = poolData.algo;
    this.blob_type = poolData.blob_type;

    setInterval(function(pool) {
        if (pool.keepAlive && pool.socket && is_active_pool(pool.hostname)) pool.sendData('keepalived');
    }, 30000, this);

    this.connect = function(){
        for (let worker in cluster.workers){
            if (cluster.workers.hasOwnProperty(worker)){
                cluster.workers[worker].send({type: 'disablePool', pool: this.hostname});
            }
        }
        this.active = false;

	function connect2(ssl, port, hostname, allowSelfSignedSSL) {
                try {
                    if (activePools[hostname].socket !== null){
                        activePools[hostname].socket.end();
                        activePools[hostname].socket.destroy();
                    }
                } catch (e) {
                    console.warn(global.threadName + "Had issues murdering the old socket. Om nom: " + e)
                }
                activePools[hostname].socket = null;

	        if (ssl){
	            activePools[hostname].socket = tls.connect(port, hostname, {rejectUnauthorized: allowSelfSignedSSL})
		    .on('connect', ()=>{ poolSocket(hostname); })
		    .on('error', (err)=>{
	                setTimeout(connect2, 30*1000, ssl, port, hostname, allowSelfSignedSSL);
	                console.warn(`${global.threadName}SSL pool socket connect error from ${hostname}: ${err}`);
	            });
	        } else {
	            activePools[hostname].socket = net.connect(port, hostname)
		    .on('connect', ()=>{ poolSocket(hostname); })
		    .on('error', (err)=>{
	                setTimeout(connect2, 30*1000, ssl, port, hostname, allowSelfSignedSSL);
	                console.warn(`${global.threadName}Plain pool socket connect error from ${hostname}: ${err}`);
	            });
	        }
	}

	connect2(this.ssl, this.port, this.hostname, this.allowSelfSignedSSL);
    };
    this.sendData = function (method, params) {
        if (typeof params === 'undefined'){
            params = {};
        }
        let rawSend = {
            method: method,
            id: this.sendId++,
        };
        if (typeof this.id !== 'undefined'){
            params.id = this.id;
        }
        rawSend.params = params;
        if (!this.socket.writable){
            return false;
        }
        this.socket.write(JSON.stringify(rawSend) + '\n');
        this.sendLog[rawSend.id] = rawSend;
        debug.pool(`Sent ${JSON.stringify(rawSend)} to ${this.hostname}`);
    };
    this.login = function () {
        this.sendData('login', {
            login: this.username,
            pass: this.password,
            agent: 'xmr-node-proxy/' + PROXY_VERSION
        });
        this.active = true;
        for (let worker in cluster.workers){
            if (cluster.workers.hasOwnProperty(worker)){
                cluster.workers[worker].send({type: 'enablePool', pool: this.hostname});
            }
        }
    };
    this.sendShare = function (worker, shareData) {
        //btID - Block template ID in the poolJobs circ buffer.
        let job = this.poolJobs[worker.id].toarray().filter(function (job) {
            return job.id === shareData.btID;
        })[0];
        if (job){
            this.sendData('submit', {
                job_id: job.masterJobID,
                nonce: shareData.nonce,
                result: shareData.resultHash,
                workerNonce: shareData.workerNonce,
                poolNonce: job.poolNonce
            });
        }
    };
}

// Master Functions
/*
The master performs the following tasks:
1. Serve all API calls.
2. Distribute appropriately modified block template bases to all pool servers.
3. Handle all to/from the various pool servers.
4. Manage and suggest miner changes in order to achieve correct h/s balancing between the various systems.
 */
function connectPools(){
    global.config.pools.forEach(function (poolData) {
        if (!poolData.coin) poolData.coin = "xmr";
        if (activePools.hasOwnProperty(poolData.hostname)){
            return;
        }
        activePools[poolData.hostname] = new Pool(poolData);
        activePools[poolData.hostname].connect();
    });
    let seen_coins = {};
    if (global.config.developerShare > 0){
        for (let pool in activePools){
            if (activePools.hasOwnProperty(pool)){
                if (seen_coins.hasOwnProperty(activePools[pool].coin)){
                    return;
                }
                let devPool = activePools[pool].coinFuncs.devPool;
                if (activePools.hasOwnProperty(devPool.hostname)){
                    return;
                }
                activePools[devPool.hostname] = new Pool(devPool);
                activePools[devPool.hostname].connect();
                seen_coins[activePools[pool].coin] = true;
            }
        }
    }
    for (let coin in seen_coins){
        if (seen_coins.hasOwnProperty(coin)){
            activeCoins[coin] = true;
        }
    }
}

let poolStates = {};

function balanceWorkers(){
    /*
    This function deals with handling how the pool deals with getting traffic balanced to the various pools.
    Step 1: Enumerate all workers (Child servers), and their miners/coins into known states
    Step 1: Enumerate all miners, move their H/S into a known state tagged to the coins and pools
    Step 2: Enumerate all pools, verify the percentages as fractions of 100.
    Step 3: Determine if we're sharing with the developers (Woohoo!  You're the best if you do!)
    Step 4: Process the state information to determine splits/moves.
    Step 5: Notify child processes of other pools to send traffic to if needed.

    The Master, as the known state holder of all information, deals with handling this data.
     */
    let minerStates = {};
    poolStates = {};
    for (let poolName in activePools){
        if (activePools.hasOwnProperty(poolName)){
            let pool = activePools[poolName];
            if (!poolStates.hasOwnProperty(pool.coin)){
                poolStates[pool.coin] = { 'totalPercentage': 0, 'activePoolCount': 0, 'devPool': false};
            }
            poolStates[pool.coin][poolName] = {
                miners: {},
                hashrate: 0,
                percentage: pool.share,
                devPool: pool.devPool,
                idealRate: 0
            };
            if(pool.devPool){
                poolStates[pool.coin].devPool = poolName;
                debug.balancer(`Found a developer pool enabled.  Pool is: ${poolName}`);
            } else if (is_active_pool(poolName)) {
                poolStates[pool.coin].totalPercentage += pool.share;
                ++ poolStates[pool.coin].activePoolCount;
            } else {
                console.error(`${global.threadName}Pool ${poolName} is disabled due to issues with it`);
            }
            if (!minerStates.hasOwnProperty(pool.coin)){
                minerStates[pool.coin] = {
                    hashrate: 0
                };
            }
        }
    }
    /*
    poolStates now contains an object that looks approximately like:
    poolStates = {
        'xmr':
            {
                'mine.xmrpool.net': {
                    'miners': {},
                    'hashrate': 0,
                    'percentage': 20,
                    'devPool': false,
                    'amtChange': 0
                 },
                 'donations.xmrpool.net': {
                     'miners': {},
                     'hashrate': 0,
                     'percentage': 0,
                     'devPool': true,
                     'amtChange': 0
                 },
                 'devPool': 'donations.xmrpool.net',
                 'totalPercentage': 20
            }
    }
     */
    for (let coin in poolStates){
        if(poolStates.hasOwnProperty(coin)){
            if (poolStates[coin].totalPercentage !== 100){
                debug.balancer(`Pools on ${coin} are using ${poolStates[coin].totalPercentage}% balance.  Adjusting.`);
                // Need to adjust all the pools that aren't the dev pool.
                if (poolStates[coin].totalPercentage) {
                    let percentModifier = 100 / poolStates[coin].totalPercentage;
                    for (let pool in poolStates[coin]){
                        if (poolStates[coin].hasOwnProperty(pool) && activePools.hasOwnProperty(pool)){
                            if (poolStates[coin][pool].devPool || !is_active_pool(pool)) continue;
                            poolStates[coin][pool].percentage *= percentModifier;
                        }
                    }
                } else if (poolStates[coin].activePoolCount) {
                    let addModifier = 100 / poolStates[coin].activePoolCount;
                    for (let pool in poolStates[coin]){
                        if (poolStates[coin].hasOwnProperty(pool) && activePools.hasOwnProperty(pool)){
                            if (poolStates[coin][pool].devPool || !is_active_pool(pool)) continue;
                            poolStates[coin][pool].percentage += addModifier;
                        }
                    }
                } else {
                    debug.balancer(`No active pools for ${coin} coin, so waiting for the next cycle.`);
                    continue;
                }

            }
            delete(poolStates[coin].totalPercentage);
            delete(poolStates[coin].activePoolCount);
        }
    }
    /*
     poolStates now contains an object that looks approximately like:
     poolStates = {
         'xmr':
         {
             'mine.xmrpool.net': {
                 'miners': {},
                 'hashrate': 0,
                 'percentage': 100,
                 'devPool': false
             },
             'donations.xmrpool.net': {
                 'miners': {},
                 'hashrate': 0,
                 'percentage': 0,
                 'devPool': true
             },
             'devPool': 'donations.xmrpool.net',
         }
     }
     */
    for (let workerID in activeWorkers){
        if (activeWorkers.hasOwnProperty(workerID)){
            for (let minerID in activeWorkers[workerID]){
                if (activeWorkers[workerID].hasOwnProperty(minerID)){
                    let miner = activeWorkers[workerID][minerID];
                    try {
                        let minerCoin = miner.coin;
                        if (!minerStates.hasOwnProperty(minerCoin)){
                            minerStates[minerCoin] = {
                                hashrate: 0
                            };
                        }
                        minerStates[minerCoin].hashrate += miner.avgSpeed;
                        poolStates[minerCoin][miner.pool].hashrate += miner.avgSpeed;
                        poolStates[minerCoin][miner.pool].miners[`${workerID}_${minerID}`] = miner.avgSpeed;
                    } catch (err) {}
                }
            }
        }
    }
    /*
    poolStates now contains the hashrate per pool.  This can be compared against minerStates/hashRate to determine
    the approximate hashrate that should be moved between pools once the general hashes/second per pool/worker
    is determined.
     */

    for (let coin in poolStates){
        if (poolStates.hasOwnProperty(coin) && minerStates.hasOwnProperty(coin)){
            let coinMiners = minerStates[coin];
            let coinPools = poolStates[coin];
            let devPool = coinPools.devPool;
            let highPools = {};
            let lowPools = {};
            delete(coinPools.devPool);
            if (devPool){
                let devHashrate = Math.floor(coinMiners.hashrate * (global.config.developerShare/100));
                coinMiners.hashrate -= devHashrate;
                coinPools[devPool].idealRate = devHashrate;
                debug.balancer(`DevPool on ${coin} is enabled.  Set to ${global.config.developerShare}% and ideally would have ${coinPools[devPool].idealRate}.  Currently has ${coinPools[devPool].hashrate}`);
                if (is_active_pool(devPool) && coinPools[devPool].idealRate > coinPools[devPool].hashrate){
                    lowPools[devPool] = coinPools[devPool].idealRate - coinPools[devPool].hashrate;
                    debug.balancer(`Pool ${devPool} is running a low hashrate compared to ideal.  Want to increase by: ${lowPools[devPool]} h/s`);
                } else if (!is_active_pool(devPool) || coinPools[devPool].idealRate < coinPools[devPool].hashrate){
                    highPools[devPool] = coinPools[devPool].hashrate - coinPools[devPool].idealRate;
                    debug.balancer(`Pool ${devPool} is running a high hashrate compared to ideal.  Want to decrease by: ${highPools[devPool]} h/s`);
                }
            }
            for (let pool in coinPools){
                if (coinPools.hasOwnProperty(pool) && pool !== devPool && activePools.hasOwnProperty(pool)){
                    coinPools[pool].idealRate = Math.floor(coinMiners.hashrate * (coinPools[pool].percentage/100));
                    if (is_active_pool(pool) && coinPools[pool].idealRate > coinPools[pool].hashrate){
                        lowPools[pool] = coinPools[pool].idealRate - coinPools[pool].hashrate;
                        debug.balancer(`Pool ${pool} is running a low hashrate compared to ideal.  Want to increase by: ${lowPools[pool]} h/s`);
                    } else if (!is_active_pool(pool) || coinPools[pool].idealRate < coinPools[pool].hashrate){
                        highPools[pool] = coinPools[pool].hashrate - coinPools[pool].idealRate;
                        debug.balancer(`Pool ${pool} is running a high hashrate compared to ideal.  Want to decrease by: ${highPools[pool]} h/s`);
                    }
                    //activePools[pool].share = coinPools[pool].percentage;
                }
            }
            if (Object.keys(highPools).length === 0 && Object.keys(lowPools).length === 0){
                debug.balancer(`No high or low ${coin} coin pools, so waiting for the next cycle.`);
                continue;
            }
            let freed_miners = {};
            if (Object.keys(highPools).length > 0){
                for (let pool in highPools){
                    if (highPools.hasOwnProperty(pool)){
                        for (let miner in coinPools[pool].miners){
                            if (coinPools[pool].miners.hasOwnProperty(miner)){
                                if ((!is_active_pool(pool) || coinPools[pool].miners[miner] <= highPools[pool]) && coinPools[pool].miners[miner] !== 0){
                                    highPools[pool] -= coinPools[pool].miners[miner];
                                    freed_miners[miner] = coinPools[pool].miners[miner];
                                    debug.balancer(`Freeing up ${miner} on ${pool} for ${freed_miners[miner]} h/s`);
                                    delete(coinPools[pool].miners[miner]);
                                }
                            }
                        }
                    }
                }
            }
            let minerChanges = {};
            if (Object.keys(lowPools).length > 0){
                for (let pool in lowPools){
                    if (lowPools.hasOwnProperty(pool)){
                        minerChanges[pool] = [];
                        // fit low pools without overflow
                        if (Object.keys(freed_miners).length > 0){
                            for (let miner in freed_miners){
                                if (freed_miners.hasOwnProperty(miner)){
                                    if (freed_miners[miner] <= lowPools[pool]){
                                        minerChanges[pool].push(miner);
                                        lowPools[pool] -= freed_miners[miner];
                                        debug.balancer(`Snagging up ${miner} for ${pool} for ${freed_miners[miner]} h/s`);
                                        delete(freed_miners[miner]);
                                    }
                                }
                            }
                        }
                        if(lowPools[pool] > 100){
                            for (let donatorPool in coinPools){
                                if(coinPools.hasOwnProperty(donatorPool) && !lowPools.hasOwnProperty(donatorPool)){
                                    for (let miner in coinPools[donatorPool].miners){
                                        if (coinPools[donatorPool].miners.hasOwnProperty(miner)){
                                            if (coinPools[donatorPool].miners[miner] <= lowPools[pool] && coinPools[donatorPool].miners[miner] !== 0){
                                                minerChanges[pool].push(miner);
                                                lowPools[pool] -= coinPools[donatorPool].miners[miner];
                                                debug.balancer(`Moving ${miner} for ${pool} from ${donatorPool} for ${coinPools[donatorPool].miners[miner]} h/s`);
                                                delete(coinPools[donatorPool].miners[miner]);
                                            }
                                            if (lowPools[pool] < 50){
                                                break;
                                            }
                                        }
                                    }
                                    if (lowPools[pool] < 50){
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                // fit low pools with overflow except devPool
                if (Object.keys(freed_miners).length > 0){
                    for (let pool in lowPools){
                        if (lowPools.hasOwnProperty(pool) && pool !== devPool){
                            if (!(pool in minerChanges)) minerChanges[pool] = [];
                            for (let miner in freed_miners){
                                if (freed_miners.hasOwnProperty(miner)){
                                    minerChanges[pool].push(miner);
                                    lowPools[pool] -= freed_miners[miner];
                                    debug.balancer(`Moving overflow ${miner} for ${pool} for ${freed_miners[miner]} h/s`);
                                    delete(freed_miners[miner]);
                                }
                            }
                        }
                    }
                }
            }
            for (let pool in minerChanges){
                if(minerChanges.hasOwnProperty(pool) && minerChanges[pool].length > 0){
                    minerChanges[pool].forEach(function(miner){
                        let minerBits = miner.split('_');
                        cluster.workers[minerBits[0]].send({
                            type: 'changePool',
                            worker: minerBits[1],
                            pool: pool
                        });
                    });
                }
            }
        }
    }
}

function enumerateWorkerStats() {
    let stats, global_stats = {miners: 0, hashes: 0, hashRate: 0, diff: 0};
    for (let poolID in activeWorkers){
        if (activeWorkers.hasOwnProperty(poolID)){
            stats = {
                miners: 0,
                hashes: 0,
                hashRate: 0,
                diff: 0
            };
            let inactivityDeadline = (typeof global.config.minerInactivityTime === 'undefined') ? Math.floor((Date.now())/1000) - 120
                : (global.config.minerInactivityTime <= 0 ? 0 : Math.floor((Date.now())/1000) - global.config.minerInactivityTime);
            for (let workerID in activeWorkers[poolID]){
                if (activeWorkers[poolID].hasOwnProperty(workerID)) {
                    let workerData = activeWorkers[poolID][workerID];
                    if (typeof workerData !== 'undefined') {
                        try{
                            if (workerData.lastContact < inactivityDeadline){
                                delete activeWorkers[poolID][workerID];
                                continue;
                            }
                            stats.miners += 1;
                            stats.hashes += workerData.hashes;
                            stats.hashRate += workerData.avgSpeed;
                            stats.diff += workerData.diff;
                        } catch (err) {
                            delete activeWorkers[poolID][workerID];
                        }
                    } else {
                        delete activeWorkers[poolID][workerID];
                    }
                }
            }
            global_stats.miners += stats.miners;
            global_stats.hashes += stats.hashes;
            global_stats.hashRate += stats.hashRate;
            global_stats.diff += stats.diff;
            debug.workers(`Worker: ${poolID} currently has ${stats.miners} miners connected at ${stats.hashRate} h/s with an average diff of ${Math.floor(stats.diff/stats.miners)}`);
        }
    }

    let pool_hs = "";
    for (let coin in poolStates) {
        if (!poolStates.hasOwnProperty(coin)) continue;
        for (let pool in poolStates[coin] ){
            if (!poolStates[coin].hasOwnProperty(pool) || !activePools.hasOwnProperty(pool) || poolStates[coin][pool].devPool || poolStates[coin][pool].hashrate === 0) continue;
            if (pool_hs != "") pool_hs += ", ";
            pool_hs += `${pool}/${poolStates[coin][pool].percentage.toFixed(2)}%`;
        }
    }
    if (pool_hs != "") pool_hs = " (" + pool_hs + ")";

    console.log(`The proxy currently has ${global_stats.miners} miners connected at ${global_stats.hashRate} h/s${pool_hs} with an average diff of ${Math.floor(global_stats.diff/global_stats.miners)}`);
}

function poolSocket(hostname){
    let pool = activePools[hostname];
    let socket = pool.socket;
    let dataBuffer = '';
    socket.on('data', (d) => {
        dataBuffer += d;
        if (dataBuffer.indexOf('\n') !== -1) {
            let messages = dataBuffer.split('\n');
            let incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
            for (let i = 0; i < messages.length; i++) {
                let message = messages[i];
                if (message.trim() === '') {
                    continue;
                }
                let jsonData;
                try {
                    jsonData = JSON.parse(message);
                }
                catch (e) {
                    if (message.indexOf('GET /') === 0) {
                        if (message.indexOf('HTTP/1.1') !== -1) {
                            socket.end('HTTP/1.1' + httpResponse);
                            break;
                        }
                        else if (message.indexOf('HTTP/1.0') !== -1) {
                            socket.end('HTTP/1.0' + httpResponse);
                            break;
                        }
                    }

                    console.warn(`${global.threadName}Pool wrong reply error from ${pool.hostname}: ${message}`);
                    socket.destroy();

                    break;
                }
                handlePoolMessage(jsonData, pool.hostname);
            }
            dataBuffer = incomplete;
        }
    }).on('error', (err) => {
        activePools[pool.hostname].connect();
        console.warn(`${global.threadName}Pool socket error from ${pool.hostname}: ${err}`);
    }).on('close', () => {
        activePools[pool.hostname].connect();
        console.warn(`${global.threadName}Pool socket closed from ${pool.hostname}`);
    });
    socket.setKeepAlive(true);
    socket.setEncoding('utf8');
    console.log(`${global.threadName}Connected to pool: ${pool.hostname}`);
    pool.login();
}

function handlePoolMessage(jsonData, hostname){
    let pool = activePools[hostname];
    debug.pool(`Received ${JSON.stringify(jsonData)} from ${pool.hostname}`);
    if (jsonData.hasOwnProperty('method')){
        // The only time method is set, is with a push of data.  Everything else is a reply/
        if (jsonData.method === 'job'){
            handleNewBlockTemplate(jsonData.params, hostname);
        }
    } else {
        if (jsonData.error !== null){
            activePools[hostname].connect();
            return console.error(`${global.threadName}Error response from pool ${pool.hostname}: ${JSON.stringify(jsonData.error)}`);
        }
        let sendLog = pool.sendLog[jsonData.id];
        switch(sendLog.method){
            case 'login':
                pool.id = jsonData.result.id;
                handleNewBlockTemplate(jsonData.result.job, hostname);
                break;
            case 'getjob':
                handleNewBlockTemplate(jsonData.result, hostname);
                break;
            case 'submit':
                sendLog.accepted = true;
                break;
        }
    }
}
    	
function handleNewBlockTemplate(blockTemplate, hostname){
    let pool = activePools[hostname];
    console.log(`Received new block template on ${blockTemplate.height} height with ${blockTemplate.target_diff} target difficulty from ${pool.hostname}`);
    if(pool.activeBlocktemplate){
        if (pool.activeBlocktemplate.job_id === blockTemplate.job_id){
            debug.pool('No update with this job, it is an upstream dupe');
            return;
        }
        debug.pool('Storing the previous block template');
        pool.pastBlockTemplates.enq(pool.activeBlocktemplate);
    }
    if (!blockTemplate.algo) blockTemplate.algo = pool.algo;
    if (!blockTemplate.blob_type) blockTemplate.blob_type = pool.blob_type;
    pool.activeBlocktemplate = new pool.coinFuncs.MasterBlockTemplate(blockTemplate);
    for (let id in cluster.workers){
        if (cluster.workers.hasOwnProperty(id)){
            cluster.workers[id].send({
                host: hostname,
                type: 'newBlockTemplate',
                data: pool.coinFuncs.getMasterJob(pool, id)
            });
        }
    }
}

function is_active_pool(hostname) {
    let pool = activePools[hostname];
    if ((cluster.isMaster && !pool.socket) || !pool.active || pool.activeBlocktemplate === null) return false;

    let top_height = 0;
    for (let poolName in activePools){
        if (!activePools.hasOwnProperty(poolName)) continue;
        let pool2 = activePools[poolName];
        if (pool2.coin != pool.coin) continue;
        if ((cluster.isMaster && !pool2.socket) || !pool2.active || pool2.activeBlocktemplate === null) continue;
        if (Math.abs(pool2.activeBlocktemplate.height - pool.activeBlocktemplate.height) > 1000) continue; // different coin templates, can't compare here
        if (pool2.activeBlocktemplate.height > top_height) top_height = pool2.activeBlocktemplate.height;
    }

    if (pool.activeBlocktemplate.height < top_height - 5) return false;
    return true;
}

// Miner Definition
function Miner(id, params, ip, pushMessage, portData, minerSocket) {
    // Arguments
    // minerId, params, ip, pushMessage, portData
    // Username Layout - <address in BTC or XMR>.<Difficulty>
    // Password Layout - <password>.<miner identifier>.<payment ID for XMR>
    // Default function is to use the password so they can login.  Identifiers can be unique, payment ID is last.
    // If there is no miner identifier, then the miner identifier is set to the password
    // If the password is x, aka, old-logins, we're not going to allow detailed review of miners.

    // Miner Variables
    this.coin = portData.coin;
    this.coinFuncs = require(`./lib/${this.coin}.js`)();
    this.coinSettings = global.config.coinSettings[this.coin];
    this.login = params.login;  // Documentation purposes only.
    this.user = params.login;  // For accessControl and workerStats.
    this.password = params.pass;  // For accessControl and workerStats.
    this.agent = params.agent;  // Documentation purposes only.
    this.ip = ip;  // Documentation purposes only.
    this.socket = minerSocket;
    this.messageSender = pushMessage;
    this.error = "";
    this.valid_miner = true;
    this.incremented = false;
    let diffSplit = this.login.split("+");
    this.fixed_diff = false;
    this.difficulty = portData.diff;
    this.connectTime = Date.now();

    if (!defaultPools.hasOwnProperty(portData.coin) || !is_active_pool(defaultPools[portData.coin])) {
        for (let poolName in activePools){
            if (activePools.hasOwnProperty(poolName)){
                let pool = activePools[poolName];
                if (pool.coin != portData.coin) continue;
		if (is_active_pool(poolName)) {
                    this.pool = poolName;
                    break;
                }
            }
        }
    }
    if (!this.pool) this.pool = defaultPools[portData.coin];

    if (diffSplit.length === 2) {
        this.fixed_diff = true;
        this.difficulty = Number(diffSplit[1]);
        this.user = diffSplit[0];
    } else if (diffSplit.length > 2) {
        this.error = "Too many options in the login field";
        this.valid_miner = false;
    }

    if (activePools[this.pool].activeBlocktemplate === null){
        this.error = "No active block template";
        this.valid_miner = false;
    }

    // Verify if user/password is in allowed client connects
    if (!isAllowedLogin(this.user, this.password)) {
        this.error = "Unauthorized access";
        this.valid_miner = false;
    }

    this.id = id;
    this.heartbeat = function () {
        this.lastContact = Date.now();
    };
    this.heartbeat();

    // VarDiff System
    this.lastShareTime = Date.now() / 1000 || 0;

    this.shares = 0;
    this.blocks = 0;
    this.hashes = 0;
    this.logString = this.id + " IP: " + this.ip;

    this.validJobs = support.circularBuffer(5);

    this.cachedJob = null;

    let pass_split = params.pass.split(":");
    this.identifier = pass_split[0];

    this.minerStats = function(){
        if (this.socket.destroyed){
            delete activeMiners[this.id];
            return;
        }
        return {
            shares: this.shares,
            blocks: this.blocks,
            hashes: this.hashes,
            avgSpeed: Math.floor(this.hashes/(Math.floor((Date.now() - this.connectTime)/1000))),
            diff: this.difficulty,
            connectTime: this.connectTime,
            lastContact: Math.floor(this.lastContact/1000),
            lastShare: this.lastShareTime,
            coin: this.coin,
            pool: this.pool,
            id: this.id,
            identifier: this.identifier,
            ip: this.ip,
            agent: this.agent,
        };
    };

    // Support functions for how miners activate and run.
    this.updateDifficulty = function(){
        if (this.hashes > 0 && !this.fixed_diff) {
            const new_diff = Math.floor(this.hashes / (Math.floor((Date.now() - this.connectTime) / 1000))) * this.coinSettings.shareTargetTime;
            if (this.setNewDiff(new_diff)) {
                this.messageSender('job', this.getJob(activeMiners[this.id], activePools[this.pool].activeBlocktemplate));
            }
        }
    };

    this.setNewDiff = function (difficulty) {
        this.newDiff = Math.round(difficulty);
        if (this.newDiff > this.coinSettings.maxDiff) {
            this.newDiff = this.coinSettings.maxDiff;
        }
        if (this.newDiff < this.coinSettings.minDiff) {
            this.newDiff = this.coinSettings.minDiff;
        }
        if (this.difficulty === this.newDiff) {
            return false;
        }
        debug.diff(global.threadName + "Difficulty change to: " + this.newDiff + " For: " + this.logString);
        if (this.hashes > 0){
            debug.diff(global.threadName + "Hashes: " + this.hashes + " in: " + Math.floor((Date.now() - this.connectTime)/1000) + " seconds gives: " +
                Math.floor(this.hashes/(Math.floor((Date.now() - this.connectTime)/1000))) + " hashes/second or: " +
                Math.floor(this.hashes/(Math.floor((Date.now() - this.connectTime)/1000))) *this.coinSettings.shareTargetTime + " difficulty versus: " + this.newDiff);
        }
        return true;
    };

    this.getJob = this.coinFuncs.getJob;
}

// Slave Functions
function isAllowedLogin(username, password) {
    // If controlled login is not enabled, everybody can connnect (return true)
    if (typeof global.config['accessControl'] !== 'object'
        || global.config['accessControl'].enabled !== true) {
        return true;
    }

    // If user is in the list (return true)
    if (isInAccessControl(username, password)) {
        return true;
    }
    // If user is not in the list ...
    else {

        // ... and accessControl has not been loaded in last minute (prevent HD flooding in case of attack)
        if (lastAccessControlLoadTime === null
            || (Date.now() - lastAccessControlLoadTime) / 1000 > 60) {

            // Take note of new load time
            lastAccessControlLoadTime = Date.now();

            // Re-load file from disk and inject in accessControl
            accessControl = JSON.parse(fs.readFileSync(global.config['accessControl']['controlFile']));

            // Re-verify if the user is in the list
            return isInAccessControl(username, password);
        }

        // User is not in the list, and not yet ready to re-load from disk
        else {

            // TODO Take notes of IP/Nb of rejections.  Ultimately insert IP in bans after X threshold
            return false;
        }
    }
}
function isInAccessControl(username, password) {
    return typeof accessControl[username] !== 'undefined'
            && accessControl[username] === password;
}

function handleMinerData(method, params, ip, portData, sendReply, pushMessage, minerSocket) {
    /*
    Deals with handling the data from miners in a sane-ish fashion.
     */
    let miner = activeMiners[params.id];
    // Check for ban here, so preconnected attackers can't continue to screw you
    if (ip in bans) {
        // Handle IP ban off clip.
        sendReply("IP Address currently banned");
        return;
    }
    switch (method) {
        case 'login':
            let difficulty = portData.difficulty;
            let minerId = uuidV4();
            if (!portData.coin) portData.coin = "xmr";
            miner = new Miner(minerId, params, ip, pushMessage, portData, minerSocket);
            if (!miner.valid_miner) {
                console.warn(global.threadName + "Invalid miner, disconnecting due to: " + miner.error);
                sendReply(miner.error);
                return;
            }
            process.send({type: 'newMiner', data: miner.port});
            activeMiners[minerId] = miner;
            sendReply(null, {
                id: minerId,
                job: miner.getJob(miner, activePools[miner.pool].activeBlocktemplate),
                status: 'OK'
            });
            return minerId;
        case 'getjob':
            if (!miner) {
                sendReply('Unauthenticated');
                return;
            }
            miner.heartbeat();
            sendReply(null, miner.getJob(miner, activePools[miner.pool].activeBlocktemplate));
            break;
        case 'submit':
            if (!miner) {
                sendReply('Unauthenticated');
                return;
            }
            miner.heartbeat();

            let job = miner.validJobs.toarray().filter(function (job) {
                return job.id === params.job_id;
            })[0];

            if (!job) {
                sendReply('Invalid job id');
                return;
            }

            params.nonce = params.nonce.substr(0, 8).toLowerCase();
            if (!nonceCheck.test(params.nonce)) {
                console.warn(global.threadName + 'Malformed nonce: ' + JSON.stringify(params) + ' from ' + miner.logString);
                sendReply('Duplicate share');
                return;
            }

            if (job.submissions.indexOf(params.nonce) !== -1) {
                console.warn(global.threadName + 'Duplicate share: ' + JSON.stringify(params) + ' from ' + miner.logString);
                sendReply('Duplicate share');
                return;
            }

            job.submissions.push(params.nonce);
            let activeBlockTemplate = activePools[miner.pool].activeBlocktemplate;
            let pastBlockTemplates = activePools[miner.pool].pastBlockTemplates;

            let blockTemplate = activeBlockTemplate.id === job.templateID ? activeBlockTemplate : pastBlockTemplates.toarray().filter(function (t) {
                return t.id === job.templateID;
            })[0];

            if (!blockTemplate) {
                console.warn(global.threadName + 'Block expired, Height: ' + job.height + ' from ' + miner.logString);
                if (miner.incremented === false){
                    miner.newDiff = miner.difficulty + 1;
                    miner.incremented = true;
                } else {
                    miner.newDiff = miner.difficulty - 1;
                    miner.incremented = false;
                }
                miner.messageSender('job', miner.getJob(miner, activePools[miner.pool].activeBlocktemplate, true));
                sendReply('Block expired');
                return;
            }

            let shareAccepted = miner.coinFuncs.processShare(miner, job, blockTemplate, params.nonce, params.result);

            if (!shareAccepted) {
                sendReply('Low difficulty share');
                return;
            }

            miner.lastShareTime = Date.now() / 1000 || 0;

            sendReply(null, {status: 'OK'});
            break;
        case 'keepalived':
            if (!miner) {
                sendReply('Unauthenticated');
                return;
            }
            miner.heartbeat();
            sendReply(null, {
                status: 'KEEPALIVED'
            });
            break;
    }
}

function activateHTTP() {
	var jsonServer = http.createServer((req, res) => {
		if (global.config.httpUser && global.config.httpPass) {
			var auth = req.headers['authorization'];  // auth is in base64(username:password)  so we need to decode the base64
			if (!auth) {
				res.statusCode = 401;
				res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
				res.end('<html><body>Unauthorized XNP access.</body></html>');
				return;
			}
			debug.misc("Authorization Header is: ", auth);
			var tmp = auth.split(' ');
	                var buf = new Buffer(tmp[1], 'base64');
        	        var plain_auth = buf.toString();
			debug.misc("Decoded Authorization ", plain_auth);
			var creds = plain_auth.split(':');
			var username = creds[0];
			var password = creds[1];
			if (username !== global.config.httpUser || password !== global.config.httpPass) {
				res.statusCode = 401;
				res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
				res.end('<html><body>Wrong login.</body></html>');
				return;
			}
		}

		if (req.url == "/") {
			let totalWorkers = 0, totalHashrate = 0;
			let poolHashrate = [];
			let tablePool = "";
			let tableBody = "";
    			for (let workerID in activeWorkers) {
				if (!activeWorkers.hasOwnProperty(workerID)) continue;
				for (let minerID in activeWorkers[workerID]){
                			if (!activeWorkers[workerID].hasOwnProperty(minerID)) continue;
					let miner = activeWorkers[workerID][minerID];
					if (typeof(miner) === 'undefined' || !miner) continue;	
					let name = (miner.identifier && miner.identifier != "x") ? miner.identifier + " (" + miner.ip + ")" : miner.ip;
					++ totalWorkers;
					totalHashrate += miner.avgSpeed;
					if (!poolHashrate[miner.pool]) poolHashrate[miner.pool] = 0;
					poolHashrate[miner.pool] += miner.avgSpeed;
					tableBody += `
					<tr>
						<td><TAB TO=t1>${name}</td>
						<td><TAB TO=t2>${miner.avgSpeed}</td>
						<td><TAB TO=t3>${miner.diff}</td>
						<td><TAB TO=t4>${miner.shares}</td>
						<td><TAB TO=t5>${miner.hashes}</td>
						<td><TAB TO=t6>${moment.unix(miner.lastShare).fromNow(true)}</td>
						<td><TAB TO=t7>${moment.unix(miner.lastContact).fromNow(true)}</td>
						<td><TAB TO=t8>${moment(miner.connectTime).fromNow(true)}</td>
						<td><TAB TO=t9>${miner.pool}</td>
						<td><TAB TO=t10>${miner.agent}</td>
					</tr>
					`;
				}
			}
    			for (let poolName in poolHashrate) {
				let poolPercentage = (100*poolHashrate[poolName]/totalHashrate).toFixed(2);
				let targetDiff = activePools[poolName].activeBlocktemplate ? activePools[poolName].activeBlocktemplate.targetDiff : "?";
				tablePool += `<h2> ${poolName}: ${poolHashrate[poolName]} H/s or ${poolPercentage}% (${targetDiff} diff)</h2>
				`;
			}	
			res.writeHead(200, {'Content-type':'text/html'});
			res.write(`
<html lang="en"><head>
	<title>XNP v${PROXY_VERSION} Hashrate Monitor</title>
	<meta charset="utf-8">
	<meta http-equiv="refresh" content="60">
	<style>
	  html, body {
	    font-family: 'Saira Semi Condensed', sans-serif;
	    font-size: 14px;
	    text-align: center;
	  }
	
	  .sorted-table {
	    margin: auto;
	    width: 60%;
	    text-align: center;
	  }
	
	  .sorted-table td, .sorted-table th {
	    border-bottom: 1px solid #d9d9d9;
	  }
	
	  .hover {
	    background-color: #eeeeee;
	    cursor: pointer;
	  }
	</style>
</head><body>
	<h1>XNP v${PROXY_VERSION} Hashrate Monitor</h1>
	<h2>Workers: ${totalWorkers}, Hashrate: ${totalHashrate}</h2>
	${tablePool}
	<table class="sorted-table">
		<thead>
			<th><TAB INDENT=0  ID=t1>Name</th>
			<th><TAB INDENT=60 ID=t2>Hashrate</th>
			<th><TAB INDENT=80 ID=t3>Difficulty</th>
			<th><TAB INDENT=100 ID=t4>Shares</th>
			<th><TAB INDENT=120 ID=t5>Hashes</th>
			<th><TAB INDENT=140 ID=t6>Share Ago</th>
			<th><TAB INDENT=180 ID=t7>Ping Ago</th>
			<th><TAB INDENT=220 ID=t8>Connected Ago</th>
			<th><TAB INDENT=260 ID=t9>Pool</th>
			<th><TAB INDENT=320 ID=t10>Agent</th>
		</thead>
		<tbody>
			${tableBody}
		</tbody>
	</table>
	<script src='http://cdnjs.cloudflare.com/ajax/libs/jquery/2.1.3/jquery.min.js'></script>
	<script>
	    $('table.sorted-table thead th').on("mouseover", function() {
	      var el = $(this),
	      pos = el.index();
	      el.addClass("hover");
	      $('table.sorted-table > tbody > tr > td').filter(":nth-child(" + (pos+1) + ")").addClass("hover");
	    }).on("mouseout", function() {
	      $("td, th").removeClass("hover");
	    });
	
	    var thIndex = 0, thInc = 1, curThIndex = null;
	
	    $(function() {
	      $('table.sorted-table thead th').click(function() {
	        thIndex = $(this).index();
	        sorting = [];
	        tbodyHtml = null;
	        $('table.sorted-table > tbody > tr').each(function() {
	          var str = $(this).children('td').eq(thIndex).html();
	          var re1 = /^<.+>(\\d+)<\\/.+>$/;
	          var m;
	          if (m = re1.exec(str)) {
	            var pad = "000000000000";
	            str = (pad + Number(m[1])).slice(-pad.length);
	          }
	          sorting.push(str + ', ' + $(this).index());
	        });

	        if (thIndex != curThIndex || thInc == 1) {
	          sorting = sorting.sort();
        	} else {
	          sorting = sorting.sort(function(a, b){return b.localeCompare(a)});
	        }
	
	        if (thIndex == curThIndex) {
	          thInc = 1 - thInc;
	        } else {
	          thInc = 0;
	        }
	        
	        curThIndex = thIndex;
	        sortIt();
	      });
	    })

	    function sortIt() {
	      for (var sortingIndex = 0; sortingIndex < sorting.length; sortingIndex++) {
	        rowId = parseInt(sorting[sortingIndex].split(', ')[1]);
	        tbodyHtml = tbodyHtml + $('table.sorted-table > tbody > tr').eq(rowId)[0].outerHTML;
	      }
	      $('table.sorted-table > tbody').html(tbodyHtml);
	    }
	</script>
</body></html>
`);
			res.end();
		} else if(req.url.substring(0, 5) == "/json") {
			res.writeHead(200, {'Content-type':'application/json'});
			res.write(JSON.stringify(activeWorkers) + "\r\n");
			res.end();
		} else {
			res.writeHead(404);
			res.end();
		}
	});

	jsonServer.listen(global.config.httpPort || "8081", global.config.httpAddress || "localhost")
}

function activatePorts() {
    /*
     Reads the current open ports, and then activates any that aren't active yet
     { "port": 80, "ssl": false, "diff": 5000 }
     and binds a listener to it.
     */
    async.each(global.config.listeningPorts, function (portData) {
        if (activePorts.indexOf(portData.port) !== -1) {
            return;
        }
        let handleMessage = function (socket, jsonData, pushMessage, minerSocket) {
            if (!jsonData.id) {
                console.warn(global.threadName + 'Miner RPC request missing RPC id');
                return;
            }
            else if (!jsonData.method) {
                console.warn(global.threadName + 'Miner RPC request missing RPC method');
                return;
            }
            else if (!jsonData.params) {
                console.warn(global.threadName + 'Miner RPC request missing RPC params');
                return;
            }

            let sendReply = function (error, result) {
                if (!socket.writable) {
                    return;
                }
                let sendData = JSON.stringify({
                        id: jsonData.id,
                        jsonrpc: "2.0",
                        error: error ? {code: -1, message: error} : null,
                        result: result
                    }) + "\n";
                debug.miners(`Data sent to miner (sendReply): ${sendData}`);
                socket.write(sendData);
            };
            handleMinerData(jsonData.method, jsonData.params, socket.remoteAddress, portData, sendReply, pushMessage, minerSocket);
        };

        function socketConn(socket) {
            socket.setKeepAlive(true);
            socket.setEncoding('utf8');

            let dataBuffer = '';

            let pushMessage = function (method, params) {
                if (!socket.writable) {
                    return;
                }
                let sendData = JSON.stringify({
                        jsonrpc: "2.0",
                        method: method,
                        params: params
                    }) + "\n";
                debug.miners(`Data sent to miner (pushMessage): ${sendData}`);
                socket.write(sendData);
            };

            socket.on('data', function (d) {
                dataBuffer += d;
                if (Buffer.byteLength(dataBuffer, 'utf8') > 102400) { //10KB
                    dataBuffer = null;
                    console.warn(global.threadName + 'Excessive packet size from: ' + socket.remoteAddress);
                    socket.destroy();
                    return;
                }
                if (dataBuffer.indexOf('\n') !== -1) {
                    let messages = dataBuffer.split('\n');
                    let incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
                    for (let i = 0; i < messages.length; i++) {
                        let message = messages[i];
                        if (message.trim() === '') {
                            continue;
                        }
                        let jsonData;
                        debug.miners(`Data from miner: ${message}`);
                        try {
                            jsonData = JSON.parse(message);
                        }
                        catch (e) {
                            if (message.indexOf('GET /') === 0) {
                                if (message.indexOf('HTTP/1.1') !== -1) {
                                    socket.end('HTTP/1.1' + httpResponse);
                                    break;
                                }
                                else if (message.indexOf('HTTP/1.0') !== -1) {
                                    socket.end('HTTP/1.0' + httpResponse);
                                    break;
                                }
                            }
                            console.warn(global.threadName + "Malformed message from " + socket.remoteAddress + " Message: " + message);
                            socket.destroy();
                            break;
                        }
                        handleMessage(socket, jsonData, pushMessage, socket);
                    }
                    dataBuffer = incomplete;
                }
            }).on('error', function (err) {
                if (err.code !== 'ECONNRESET') {
                    console.warn(global.threadName + "Miner socket error from " + socket.remoteAddress + ": " + err);
                }
                socket.end();
                socket.destroy();
            }).on('close', function () {
                pushMessage = function () {
                };
                debug.miners('Miner disconnected via standard close');
                socket.end();
                socket.destroy();
            });
        }

        if ('ssl' in portData && portData.ssl === true) {
            let server = tls.createServer({
                key: fs.readFileSync('cert.key'),
                cert: fs.readFileSync('cert.pem')
            }, socketConn);
	    server.listen(portData.port, global.config.bindAddress, function (error) {
                if (error) {
                    console.error(global.threadName + "Unable to start server on: " + portData.port + " Message: " + error);
                    return;
                }
                activePorts.push(portData.port);
                console.log(global.threadName + "Started server on port: " + portData.port);
            });
            server.on('error', function (error) {
                console.error(global.threadName + "Can't bind server to " + portData.port + " SSL port!");
            });
        } else {
            let server = net.createServer(socketConn);
	    server.listen(portData.port, global.config.bindAddress, function (error) {
                if (error) {
                    console.error(global.threadName + "Unable to start server on: " + portData.port + " Message: " + error);
                    return;
                }
                activePorts.push(portData.port);
                console.log(global.threadName + "Started server on port: " + portData.port);
            });
            server.on('error', function (error) {
                console.error(global.threadName + "Can't bind server to " + portData.port + " port!");
            });
        }
    });
}

function checkActivePools() {
    for (let badPool in activePools){
        if (activePools.hasOwnProperty(badPool) && !activePools[badPool].active) {
            for (let pool in activePools) {
                if (activePools.hasOwnProperty(pool) && !activePools[pool].devPool && activePools[pool].coin === activePools[badPool].coin && activePools[pool].active) {
                    for (let miner in activeMiners) {
                        if (activeMiners.hasOwnProperty(miner)) {
                            let realMiner = activeMiners[miner];
                            if (realMiner.pool === badPool) {
                                realMiner.pool = pool;
                                realMiner.messageSender('job', realMiner.getJob(realMiner, activePools[pool].activeBlocktemplate));
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
}

// API Calls

// System Init

if (cluster.isMaster) {
    console.log("Xmr-Node-Proxy (XNP) v" + PROXY_VERSION);
    let numWorkers;
    try {
        let argv = require('minimist')(process.argv.slice(2));
        if (typeof argv.workers !== 'undefined') {
            numWorkers = Number(argv.workers);
        } else {
            numWorkers = require('os').cpus().length;
        }
    } catch (err) {
        console.error(`${global.threadName}Unable to set the number of workers via arguments.  Make sure to run npm install!`);
        numWorkers = require('os').cpus().length;
    }
    global.threadName = '[MASTER] ';
    console.log('Cluster master setting up ' + numWorkers + ' workers...');
    cluster.on('message', masterMessageHandler);
    for (let i = 0; i < numWorkers; i++) {
        let worker = cluster.fork();
        worker.on('message', slaveMessageHandler);
    }

    cluster.on('online', function (worker) {
        console.log('Worker ' + worker.process.pid + ' is online');
        activeWorkers[worker.id] = {};
    });

    cluster.on('exit', function (worker, code, signal) {
        console.error('Worker ' + worker.process.pid + ' died with code: ' + code + ', and signal: ' + signal);
        console.log('Starting a new worker');
        worker = cluster.fork();
        worker.on('message', slaveMessageHandler);
    });
    connectPools();
    setInterval(enumerateWorkerStats, 15*1000);
    setInterval(balanceWorkers, 90*1000);
    if (global.config.httpEnable) { 
        console.log("Activating Web API server on " + (global.config.httpAddress || "localhost") + ":" + (global.config.httpPort || "8081"));
        activateHTTP();
    }
} else {
    /*
    setInterval(checkAliveMiners, 30000);
    setInterval(retargetMiners, global.config.pool.retargetTime * 1000);
    */
    process.on('message', slaveMessageHandler);
    global.config.pools.forEach(function(poolData){
        if (!poolData.coin) poolData.coin = "xmr";
        activePools[poolData.hostname] = new Pool(poolData);
        if (poolData.default){
            defaultPools[poolData.coin] = poolData.hostname;
        }
        if (!activePools.hasOwnProperty(activePools[poolData.hostname].coinFuncs.devPool.hostname)){
            activePools[activePools[poolData.hostname].coinFuncs.devPool.hostname] = new Pool(activePools[poolData.hostname].coinFuncs.devPool);
        }
    });
    process.send({type: 'needPoolState'});
    setInterval(function(){
        for (let minerID in activeMiners){
            if (activeMiners.hasOwnProperty(minerID)){
                activeMiners[minerID].updateDifficulty();
            }
        }
    }, 45000);
    setInterval(function(){
        for (let minerID in activeMiners){
            if (activeMiners.hasOwnProperty(minerID)){
                process.send({minerID: minerID, data: activeMiners[minerID].minerStats(), type: 'workerStats'});
            }
        }
    }, 10000);
    setInterval(checkActivePools, 90000);
    activatePorts();
}
