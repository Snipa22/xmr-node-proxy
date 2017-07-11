"use strict";
const cluster = require('cluster');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const async = require('async');
const uuidV4 = require('uuid/v4');
const support = require('./lib/support.js')();
global.config = require('./config.json');

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
    workers: require('debug')('workers')
};
global.threadName = '';
let nonceCheck = new RegExp("^[0-9a-f]{8}$");
let activePorts = [];
let httpResponse = ' 200 OK\nContent-Type: text/plain\nContent-Length: 18\n\nMining Proxy Online';
let activeMiners = {};
let bans = {};
let activePools = {};
let activeWorkers = {};
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
                        if (hostname === poolData.hostname){
                            activePools[hostname] = new Pool(poolData);
                        }
                    });
                }
            });
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
    this.coin = poolData.coin;
    this.pastBlockTemplates = support.circularBuffer(4);
    this.coinFuncs = require(`./lib/${this.coin}.js`)();
    this.sendId = 1;
    this.sendLog = {};
    this.poolJobs = {};
    this.connect = function(){
        if (this.ssl){
            this.socket = tls.connect(this.port, this.hostname, ()=>{
                poolSocket(this.hostname);
            });
        } else {
            this.socket = net.connect(this.port, this.hostname, ()=>{
                poolSocket(this.hostname);
            });
        }
    };
    this.heartbeat = function(){
        if (this.keepAlive){
            this.sendData('keepalived');
        }
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
            agent: 'xmr-node-proxy/0.0.1'
        });
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
        activePools[poolData.hostname] = new Pool(poolData);
        activePools[poolData.hostname].connect();
    });
}

function enumerateWorkerStats(){
    let stats, global_stats = {miners: 0, hashes: 0, hashRate: 0, diff: 0};
    for (let poolID in activeWorkers){
        if (activeWorkers.hasOwnProperty(poolID)){
            stats = {
                miners: 0,
                hashes: 0,
                hashRate: 0,
                diff: 0
            };
            for (let workerID in activeWorkers[poolID]){
                if (activeWorkers[poolID].hasOwnProperty(workerID)) {
                    let workerData = activeWorkers[poolID][workerID];
                    if (workerData.lastContact < ((Math.floor((Date.now())/1000) - 120))){
                        delete activeWorkers[poolID][workerID];
                        continue;
                    }
                    stats.miners += 1;
                    stats.hashes += workerData.hashes;
                    stats.hashRate += workerData.avgSpeed;
                    stats.diff += workerData.diff;
                }
            }
            global_stats.miners += stats.miners;
            global_stats.hashes += stats.hashes;
            global_stats.hashRate += stats.hashRate;
            global_stats.diff += stats.diff;
            debug.workers(`Worker: ${poolID} currently has ${stats.miners} miners connected at ${stats.hashRate} h/s with an average diff of ${Math.floor(stats.diff/stats.miners)}`);
        }
    }
    console.log(`The proxy currently has ${global_stats.miners} miners connected at ${global_stats.hashRate} h/s with an average diff of ${Math.floor(global_stats.diff/global_stats.miners)}`);
}

function poolSocket(hostname){
    let pool = activePools[hostname];
    let socket = pool.socket;
    socket.setKeepAlive(true);
    socket.setEncoding('utf8');
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

                    console.warn(`${global.threadName}Socket error from ${pool.hostname} Message: ${message}`);
                    socket.destroy();

                    break;
                }
                handlePoolMessage(jsonData, pool.hostname);
            }
            dataBuffer = incomplete;
        }
    }).on('error', (err) => {
        if (err.code !== 'ECONNRESET') {
            console.warn(`${global.threadName}Socket error from ${pool.hostname} ${err}`);
        }
    }).on('close', () => {
        console.warn(`${global.threadName}Socket closed from ${pool.hostname}`);
    });
    console.log(`${global.threadName}connected to pool: ${pool.hostname}`);
    pool.login();
    setInterval(pool.heartbeat, 30000);
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
            return console.error(`Error response from pool ${pool.hostname}: ${JSON.stringify(jsonData.error)}`);
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
    console.log(`Received new block template from ${pool.hostname}`);
    if(pool.activeBlocktemplate){
        debug.pool('Storing the previous block template');
        pool.pastBlockTemplates.enq(pool.activeBlocktemplate);
    }
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

// Miner Definition
function Miner(id, params, ip, pushMessage, portData) {
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
    this.password = params.pass;  // Documentation purposes only.
    this.agent = params.agent;  // Documentation purposes only.
    this.ip = ip;  // Documentation purposes only.
    this.messageSender = pushMessage;
    this.error = "";
    this.valid_miner = true;
    this.incremented = false;
    let diffSplit = this.login.split("+");
    this.fixed_diff = false;
    this.difficulty = portData.diff;
    this.connectTime = Date.now();
    for (let pool in activePools){
        if (activePools.hasOwnProperty(pool)){
            this.pool = pool;
            break;
        }
    }

    if (diffSplit.length === 2) {
        this.fixed_diff = true;
        this.difficulty = Number(diffSplit[1]);
    } else if (diffSplit.length > 2) {
        this.error = "Too many options in the login field";
        this.valid_miner = false;
    }

    if (typeof activePools[this.pool].activeBlockTemplate !== 'undefined'){
        this.error = "No active block template";
        this.valid_miner = false;
    }

    this.id = id;
    this.heartbeat = function () {
        this.lastContact = Date.now();
    };
    this.heartbeat();

    // VarDiff System
    this.shareTimeBuffer = support.circularBuffer(8);
    this.shareTimeBuffer.enq(this.coinSettings.shareTargetTime);
    this.lastShareTime = Date.now() / 1000 || 0;

    this.shares = 0;
    this.blocks = 0;
    this.hashes = 0;
    this.logString = this.id + " IP: " + this.ip;

    this.validJobs = support.circularBuffer(5);

    this.cachedJob = null;

    this.minerStats = function(){
        return {
            shares: this.shares,
            blocks: this.blocks,
            hashes: this.hashes,
            avgSpeed: Math.floor(this.hashes/(Math.floor((Date.now() - this.connectTime)/1000))),
            diff: this.difficulty,
            lastContact: Math.floor(this.lastContact/1000),
            lastShare: this.lastShareTime,
            coin: this.coin,
            pool: this.pool,
            id: this.id
        };
    };

    // Support functions for how miners activate and run.
    this.updateDifficulty = function(){
        if (this.hashes > 0 && !this.fixed_diff) {
            this.setNewDiff(Math.floor(this.hashes / (Math.floor((Date.now() - this.connectTime) / 1000))) * this.coinSettings.shareTargetTime);
        }
    };

    this.setNewDiff = function (difficulty) {
        this.newDiff = Math.round(difficulty);
        debug.diff(global.threadName + "Difficulty: " + this.newDiff + " For: " + this.logString + " Time Average: " + this.shareTimeBuffer.average(this.lastShareTime) + " Entries: " + this.shareTimeBuffer.size() + "  Sum: " + this.shareTimeBuffer.sum());
        if (this.newDiff > this.coinSettings.maxDiff) {
            this.newDiff = this.coinSettings.maxDiff;
        }
        if (this.newDiff < this.coinSettings.minDiff) {
            this.newDiff = this.coinSettings.minDiff;
        }
        if (this.difficulty === this.newDiff) {
            return;
        }
        debug.diff(global.threadName + "Difficulty change to: " + this.newDiff + " For: " + this.logString);
        if (this.hashes > 0){
            debug.diff(global.threadName + "Hashes: " + this.hashes + " in: " + Math.floor((Date.now() - this.connectTime)/1000) + " seconds gives: " +
                Math.floor(this.hashes/(Math.floor((Date.now() - this.connectTime)/1000))) + " hashes/second or: " +
                Math.floor(this.hashes/(Math.floor((Date.now() - this.connectTime)/1000))) *this.coinSettings.shareTargetTime + " difficulty versus: " + this.newDiff);
        }
        this.messageSender('job', this.getJob(activeMiners[this.id], activePools[this.pool].activeBlocktemplate));
    };

    this.getJob = this.coinFuncs.getJob;
}

// Slave Functions
function handleMinerData(method, params, ip, portData, sendReply, pushMessage) {
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
            miner = new Miner(minerId, params, ip, pushMessage, portData);
            if (!miner.valid_miner) {
                console.log("Invalid miner, disconnecting due to: " + miner.error);
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
            break;
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

            let now = Date.now() / 1000 || 0;
            miner.shareTimeBuffer.enq(now - miner.lastShareTime);
            miner.lastShareTime = now;

            sendReply(null, {status: 'OK'});
            break;
        case 'keepalived':
            if (!miner) {
                sendReply('Unauthenticated');
                return;
            }
            sendReply(null, {
                status: 'KEEPALIVED'
            });
            break;
    }
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
        let handleMessage = function (socket, jsonData, pushMessage) {
            if (!jsonData.id) {
                console.warn('Miner RPC request missing RPC id');
                return;
            }
            else if (!jsonData.method) {
                console.warn('Miner RPC request missing RPC method');
                return;
            }
            else if (!jsonData.params) {
                console.warn('Miner RPC request missing RPC params');
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
            handleMinerData(jsonData.method, jsonData.params, socket.remoteAddress, portData, sendReply, pushMessage);
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
                        handleMessage(socket, jsonData, pushMessage);
                    }
                    dataBuffer = incomplete;
                }
            }).on('error', function (err) {
                if (err.code !== 'ECONNRESET') {
                    console.warn(global.threadName + "Socket Error from " + socket.remoteAddress + " " + err);
                }
            }).on('close', function () {
                pushMessage = function () {
                };
                debug.miners('Miner disconnected via standard close');
            });
        }

        if ('ssl' in portData && portData.ssl === true) {
            tls.createServer({
                key: fs.readFileSync('cert.key'),
                cert: fs.readFileSync('cert.pem')
            }, socketConn).listen(portData.port, global.config.bindAddress, function (error) {
                if (error) {
                    console.error(global.threadName + "Unable to start server on: " + portData.port + " Message: " + error);
                    return;
                }
                activePorts.push(portData.port);
                console.log(global.threadName + "Started server on port: " + portData.port);
            });
        } else {
            net.createServer(socketConn).listen(portData.port, global.config.bindAddress, function (error) {
                if (error) {
                    console.error(global.threadName + "Unable to start server on: " + portData.port + " Message: " + error);
                    return;
                }
                activePorts.push(portData.port);
                console.log(global.threadName + "Started server on port: " + portData.port);
            });
        }
    });
}

// API Calls

// System Init

if (cluster.isMaster) {
    let numWorkers = require('os').cpus().length;
    global.threadName = 'Master ';
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
        console.log('Worker ' + worker.process.pid + ' died with code: ' + code + ', and signal: ' + signal);
        console.log('Starting a new worker');
        worker = cluster.fork();
        worker.on('message', slaveMessageHandler);
    });
    connectPools();
    setInterval(enumerateWorkerStats, 15000);
} else {
    /*
    setInterval(checkAliveMiners, 30000);
    setInterval(retargetMiners, global.config.pool.retargetTime * 1000);
    */
    process.on('message', slaveMessageHandler);
    global.config.pools.forEach(function(poolData){
        activePools[poolData.hostname] = new Pool(poolData);
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
    activatePorts();
}
