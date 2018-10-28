"use strict";
const multiHashing = require('cryptonight-hashing');
const cnUtil = require('cryptoforknote-util');
const bignum = require('bignum');
const support = require('./support.js')();
const crypto = require('crypto');

let debug = {
    pool: require('debug')('pool'),
    diff: require('debug')('diff'),
    blocks: require('debug')('blocks'),
    shares: require('debug')('shares'),
    miners: require('debug')('miners'),
    workers: require('debug')('workers')
};

let baseDiff = bignum('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 16);

Buffer.prototype.toByteArray = function () {
    return Array.prototype.slice.call(this, 0);
};

function blockHeightCheck(nodeList, callback) {
    let randomNode = nodeList[Math.floor(Math.random() * nodeList.length)].split(':');

}

function getRemoteNodes() {
    let knownNodes = [
        '162.213.38.245:18081',
        '116.93.119.79:18081',
        '85.204.96.231:18081',
        '107.167.87.242:18081',
        '107.167.93.58:18081',
        '199.231.85.122:18081',
        '192.110.160.146:18081'
    ]; // Prefill the array with known good nodes for now.  Eventually will try to download them via DNS or http.
}

function parse_blob_type(blob_type_str) {
    if (typeof(blob_type_str) === 'undefined') return 0;
    switch (blob_type_str) {
        case 'cryptonote':      return 0; // Monero
        case 'forknote1':       return 1;
        case 'forknote2':       return 2; // Almost all Forknote coins
        case 'cryptonote2':     return 3; // Masari
        case 'cryptonote_ryo':  return 4; // Ryo
        case 'cryptonote_loki': return 5; // Loki
    }
    return 0;
}

function parse_algo_variant(algo_str, variant) {
    if (typeof(variant) === 'undefined' && typeof(algo_str) === 'undefined') variant = 1;
    if (typeof(algo_str) === 'undefined') return variant;
    switch (algo_str) {
        case 'cn':
        case 'cryptonight':
        case 'cn-lite':
        case 'cryptonight-lite':
        case 'cn-heavy':
        case 'cn-heavy/0':
        case 'cryptonight-heavy':
        case 'cryptonight-heavy/0':
        case 'cn/0':
        case 'cryptonight/0':
        case 'cn-lite/0':
        case 'cryptonight-lite/0':     return 0;

        case 'cn/1':
        case 'cryptonight/1':
        case 'cn-lite/1':
        case 'cryptonight-lite/1':
        case 'cn-heavy/xhv':
        case 'cryptonight-heavy/xhv':  return 1;

        case 'cn-heavy/tube':
        case 'cryptonight-heavy/tube': return 2;

        case 'cn/xtl':
        case 'cryptonight/xtl':        return 3;

        case 'cn/msr':
        case 'cryptonight/msr':        return 4;

        case 'cn/xao':
        case 'cryptonight/xao':        return 6;

        case 'cn/rto':
        case 'cryptonight/rto':        return 7;

        case 'cn/2':
        case 'cryptonight/2':          return 8;
    }
    return 1;
}

function detectAlgo(default_pool_algo_set, block_version) {
    if ("cn/2" in default_pool_algo_set && "cn/1" in default_pool_algo_set) return block_version >= 8 ? "cn/2" : "cn/1"; // monero fork
    const default_pool_algo_arr = Object.keys(default_pool_algo_set);
    if (default_pool_algo_arr.length == 1) return default_pool_algo_arr[0];
    console.error("Can't not correctly detect block template algorithm from the list of provided default algorithms (please reduce it to single item): " + default_pool_algo_arr.join(", "));
    return default_pool_algo_arr[0];
}

function parse_algo_func(algo_str) {
    if (typeof(algo_str) === 'undefined') return multiHashing.cryptonight;
    if (algo_str.includes('lite')) return multiHashing.cryptonight_light;
    if (algo_str.includes('heavy')) return multiHashing.cryptonight_heavy;
    return multiHashing.cryptonight;
}

function BlockTemplate(template) {
    /*
     We receive something identical to the result portions of the monero GBT call.
     Functionally, this could act as a very light-weight solo pool, so we'll prep it as one.
     You know.  Just in case amirite?
     */
    this.id = template.id;
    this.blob = template.blocktemplate_blob;
    this.blob_type = template.blob_type;
    this.variant = template.variant;
    this.algo = template.algo;
    this.difficulty = template.difficulty;
    this.height = template.height;
    this.reservedOffset = template.reserved_offset;
    this.workerOffset = template.worker_offset; // clientNonceLocation
    this.targetDiff = template.target_diff;
    this.targetHex = template.target_diff_hex;
    this.buffer = new Buffer(this.blob, 'hex');
    this.previousHash = new Buffer(32);
    this.workerNonce = 0;
    this.solo = false;
    if (typeof(this.workerOffset) === 'undefined') {
        this.solo = true;
        global.instanceId.copy(this.buffer, this.reservedOffset + 4, 0, 3);
        this.buffer.copy(this.previousHash, 0, 7, 39);
    }
    this.nextBlob = function () {
        if (this.solo) {
            // This is running in solo mode.
            this.buffer.writeUInt32BE(++this.workerNonce, this.reservedOffset);
        } else {
            this.buffer.writeUInt32BE(++this.workerNonce, this.workerOffset);
        }
        return cnUtil.convert_blob(this.buffer, this.blob_type).toString('hex');
    };
}

function MasterBlockTemplate(template) {
    /*
     We receive something identical to the result portions of the monero GBT call.
     Functionally, this could act as a very light-weight solo pool, so we'll prep it as one.
     You know.  Just in case amirite?
     */
    this.blob = template.blocktemplate_blob;
    this.blob_type = parse_blob_type(template.blob_type);
    this.variant = template.variant;
    this.algo = template.algo;
    this.difficulty = template.difficulty;
    this.height = template.height;
    this.reservedOffset = template.reserved_offset;  // reserveOffset
    this.workerOffset = template.client_nonce_offset; // clientNonceLocation
    this.poolOffset = template.client_pool_offset; // clientPoolLocation
    this.targetDiff = template.target_diff;
    this.targetHex = template.target_diff_hex;
    this.buffer = new Buffer(this.blob, 'hex');
    this.previousHash = new Buffer(32);
    this.job_id = template.job_id;
    this.workerNonce = 0;
    this.poolNonce = 0;
    this.solo = false;
    if (typeof(this.workerOffset) === 'undefined') {
        this.solo = true;
        global.instanceId.copy(this.buffer, this.reservedOffset + 4, 0, 3);
        this.buffer.copy(this.previousHash, 0, 7, 39);
    }
    this.blobForWorker = function () {
        this.buffer.writeUInt32BE(++this.poolNonce, this.poolOffset);
        return this.buffer.toString('hex');
    };
}

function getJob(miner, activeBlockTemplate, bashCache) {
    if (miner.validJobs.size() >0 && miner.validJobs.get(0).templateID === activeBlockTemplate.id && !miner.newDiff && miner.cachedJob !== null && typeof bashCache === 'undefined') {
        return miner.cachedJob;
    }

    let blob = activeBlockTemplate.nextBlob();
    let target = getTargetHex(miner, activeBlockTemplate.targetDiff);
    miner.lastBlockHeight = activeBlockTemplate.height;

    let newJob = {
        id: crypto.pseudoRandomBytes(21).toString('base64'),
        extraNonce: activeBlockTemplate.workerNonce,
        height: activeBlockTemplate.height,
        difficulty: miner.difficulty,
        diffHex: miner.diffHex,
        submissions: [],
        templateID: activeBlockTemplate.id
    };

    miner.validJobs.enq(newJob);

    miner.cachedJob = {
        blob: blob,
        job_id: newJob.id,
        target: target,
        id: miner.id
    };
    if (typeof (activeBlockTemplate.variant) !== 'undefined') {
        miner.cachedJob.variant = activeBlockTemplate.variant;
    }
    if (typeof (activeBlockTemplate.algo) !== 'undefined') {
        miner.cachedJob.algo = activeBlockTemplate.algo;
    }
    return miner.cachedJob;
}

function getMasterJob(pool, workerID) {
    let activeBlockTemplate = pool.activeBlocktemplate;
    let btBlob = activeBlockTemplate.blobForWorker();
    let workerData = {
        id: crypto.pseudoRandomBytes(21).toString('base64'),
        blocktemplate_blob: btBlob,
        blob_type: activeBlockTemplate.blob_type,
        variant: activeBlockTemplate.variant,
        algo: activeBlockTemplate.algo,
        difficulty: activeBlockTemplate.difficulty,
        height: activeBlockTemplate.height,
        reserved_offset: activeBlockTemplate.reservedOffset,
        worker_offset: activeBlockTemplate.workerOffset,
        target_diff: activeBlockTemplate.targetDiff,
        target_diff_hex: activeBlockTemplate.targetHex
    };
    let localData = {
        id: workerData.id,
        masterJobID: activeBlockTemplate.job_id,
        poolNonce: activeBlockTemplate.poolNonce
    };
    if (!(workerID in pool.poolJobs)) {
        pool.poolJobs[workerID] = support.circularBuffer(4);
    }
    pool.poolJobs[workerID].enq(localData);
    return workerData;
}

function getTargetHex(miner, max_diff) {
    if (miner.newDiff) {
        miner.difficulty = miner.newDiff;
        miner.newDiff = null;
    }
    if (miner.difficulty > max_diff) {
        miner.difficulty = max_diff;
    }
    let padded = Buffer.alloc(32);
    let diffBuff = baseDiff.div(miner.difficulty).toBuffer();
    diffBuff.copy(padded, 32 - diffBuff.length);

    let buff = padded.slice(0, 4);
    let buffArray = buff.toByteArray().reverse();
    let buffReversed = new Buffer(buffArray);
    miner.target = buffReversed.readUInt32BE(0);
    return buffReversed.toString('hex');
}

// MAX_VER_SHARES_PER_SEC is maximum amount of verified shares for VER_SHARES_PERIOD second period
// other shares are just dumped to the pool to avoid proxy CPU overload during low difficulty adjustement period
const MAX_VER_SHARES_PER_SEC = 10; // per thread
const VER_SHARES_PERIOD = 5;
let verified_share_start_period;
let verified_share_num;

// for more intellegent reporting
let poolShareSize = {};
let poolShareCount = {};
let poolShareTime = {};

function processShare(miner, job, blockTemplate, nonce, resultHash) {
    let template = new Buffer(blockTemplate.buffer.length);
    blockTemplate.buffer.copy(template);
    if (blockTemplate.solo) {
        template.writeUInt32BE(job.extraNonce, blockTemplate.reservedOffset);
    } else {
        template.writeUInt32BE(job.extraNonce, blockTemplate.workerOffset);
    }

    let hash = new Buffer(resultHash, 'hex');
    let hashArray = hash.toByteArray().reverse();
    let hashNum = bignum.fromBuffer(new Buffer(hashArray));
    let hashDiff = baseDiff.div(hashNum);

    if (hashDiff.ge(blockTemplate.targetDiff)) {
        let time_now = Date.now();
        if (!verified_share_start_period || time_now - verified_share_start_period > VER_SHARES_PERIOD*1000) {
            verified_share_num = 0;
            verified_share_start_period = time_now;
        }
        if (++ verified_share_num <= MAX_VER_SHARES_PER_SEC*VER_SHARES_PERIOD) {
            // Validate share with CN hash, then if valid, blast it up to the master.
            let shareBuffer = cnUtil.construct_block_blob(template, new Buffer(nonce, 'hex'), blockTemplate.blob_type);
            let convertedBlob = cnUtil.convert_blob(shareBuffer, blockTemplate.blob_type);
            let foo = parse_algo_func(blockTemplate.algo);
            hash = foo(convertedBlob, parse_algo_variant(blockTemplate.algo, blockTemplate.variant));
            if (hash.toString('hex') !== resultHash) {
                console.error(global.threadName + "Bad share from miner " + miner.logString);
                miner.messageSender('job', miner.getJob(miner, blockTemplate, true));
                return false;
            }
        } else {
            console.error(global.threadName + "Throttling down miner share verification to avoid CPU overload: " + miner.logString);
        }
        miner.blocks += 1;
        const poolName = miner.pool;
        process.send({
            type: 'shareFind',
            host: poolName,
            data: {
                btID: blockTemplate.id,
                nonce: nonce,
                resultHash: resultHash,
                workerNonce: job.extraNonce
            }
        });

        if (!(poolName in poolShareTime)) {
            console.log(`Submitted share of ${blockTemplate.targetDiff} hashes to ${poolName} pool`);
            poolShareTime[poolName] = Date.now();
            poolShareCount[poolName] = 0;
            poolShareSize[poolName] = blockTemplate.targetDiff;
        } else if (Date.now() - poolShareTime[poolName] > 30*1000 || (poolName in poolShareSize && poolShareSize[poolName] != blockTemplate.targetDiff)) {
            if (poolShareCount[poolName]) console.log(`Submitted ${poolShareCount[poolName]} share(s) of ${poolShareSize[poolName]} hashes to ${poolName} pool`);
            poolShareTime[poolName] = Date.now();
            poolShareCount[poolName] = 1;
            poolShareSize[poolName] = blockTemplate.targetDiff;
        } else {
            ++ poolShareCount[poolName];
        }
    }
    else if (hashDiff.lt(job.difficulty)) {
        process.send({type: 'invalidShare'});
        console.warn(global.threadName + "Rejected low diff share of " + hashDiff.toString() + " from: " + miner.address + " ID: " +
            miner.identifier + " IP: " + miner.ipAddress);
        return false;
    }
    miner.shares += 1;
    miner.hashes += job.difficulty;
    return true;
}

let devPool = {
    "hostname": "devshare.moneroocean.stream",
    "port": 10032,
    "ssl": false,
    "share": 0,
    "username": "44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1",
    "password": "proxy_donations",
    "keepAlive": true,
    "coin": "xmr",
    "default": false,
    "devPool": true
};

module.exports = function () {
    return {
        devPool: devPool,
        hashSync: multiHashing.cryptonight,
        hashAsync: multiHashing.cryptonight_async,
        blockHeightCheck: blockHeightCheck,
        getRemoteNodes: getRemoteNodes,
        BlockTemplate: BlockTemplate,
        getJob: getJob,
        processShare: processShare,
        MasterBlockTemplate: MasterBlockTemplate,
        getMasterJob: getMasterJob,
        detectAlgo: detectAlgo
    };
};
