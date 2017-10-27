"use strict";
const multiHashing = require('multi-hashing');
const cnUtil = require('cryptonote-util');
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

function BlockTemplate(template) {
    /*
     We receive something identical to the result portions of the monero GBT call.
     Functionally, this could act as a very light-weight solo pool, so we'll prep it as one.
     You know.  Just in case amirite?
     */
    this.id = template.id;
    this.blob = template.blocktemplate_blob;
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
        return cnUtil.convert_blob(this.buffer).toString('hex');
    };
}

function MasterBlockTemplate(template) {
    /*
     We receive something identical to the result portions of the monero GBT call.
     Functionally, this could act as a very light-weight solo pool, so we'll prep it as one.
     You know.  Just in case amirite?
     */
    this.blob = template.blocktemplate_blob;
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
    let target = getTargetHex(miner);
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
    return miner.cachedJob;
}

function getMasterJob(pool, workerID) {
    let activeBlockTemplate = pool.activeBlocktemplate;
    let btBlob = activeBlockTemplate.blobForWorker();
    let workerData = {
        id: crypto.pseudoRandomBytes(21).toString('base64'),
        blocktemplate_blob: btBlob,
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

function getTargetHex(miner) {
    if (miner.newDiff) {
        miner.difficulty = miner.newDiff;
        miner.newDiff = null;
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
        // Validate share with CN hash, then if valid, blast it up to the master.
        let shareBuffer = cnUtil.construct_block_blob(template, new Buffer(nonce, 'hex'));
        let convertedBlob = cnUtil.convert_blob(shareBuffer);
        hash = multiHashing.cryptonight_light(convertedBlob);
        if (hash.toString('hex') !== resultHash) {
            console.error(global.threadName + "Bad share from miner " + miner.logString);
            miner.messageSender('job', miner.getJob(miner, blockTemplate, true));
            return false;
        }
        miner.blocks += 1;
        process.send({
            type: 'shareFind',
            host: miner.pool,
            data: {
                btID: blockTemplate.id,
                nonce: nonce,
                resultHash: resultHash,
                workerNonce: job.extraNonce
            }
        });
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
    "hostname": "aeon-donations.snipanet.com",
    "port": 3333,
    "ssl": false,
    "share": 0,
    "username": "WmtvM6SoYya4qzkoPB4wX7FACWcXyFPWAYzfz7CADECgKyBemAeb3dVb3QomHjRWwGS3VYzMJAnBXfUx5CfGLFZd1U7ssdXTu",
    "password": "proxy_donations",
    "keepAlive": true,
    "coin": "aeon",
    "default": false,
    "devPool": true
};

module.exports = function () {
    return {
        devPool: devPool,
        hashSync: multiHashing.cryptonight_light,
        hashAsync: multiHashing.CNLAsync,
        blockHeightCheck: blockHeightCheck,
        getRemoteNodes: getRemoteNodes,
        BlockTemplate: BlockTemplate,
        getJob: getJob,
        processShare: processShare,
        MasterBlockTemplate: MasterBlockTemplate,
        getMasterJob: getMasterJob
    };
};