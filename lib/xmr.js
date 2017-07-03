"use strict";
const multiHashing = require('multi-hashing');
const cnUtil = require('cryptonote-util');
const bignum = require('bignum');
const crypto = require('crypto');

let baseDiff = bignum('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 16);

function blockHeightCheck(nodeList, callback){
    let randomNode = nodeList[Math.floor(Math.random()*nodeList.length)].split(':');

}

function getRemoteNodes(){
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

function BlockTemplate(template){
    /*
    We receive something identical to the result portions of the monero GBT call.
    Functionally, this could act as a very light-weight solo pool, so we'll prep it as one.
    You know.  Just in case amirite?
     */
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
    if (typeof(this.workerOffset) === 'undefined'){
        this.solo = true;
        global.instanceId.copy(this.buffer, this.reservedOffset + 4, 0, 3);
        this.buffer.copy(this.previousHash, 0, 7, 39);
    }
    this.nextBlob = function(){
        if (this.solo){
            // This is running in solo mode.
            this.buffer.writeUInt32BE(++this.workerNonce, this.reservedOffset);
        } else {
            this.buffer.writeUInt32BE(++this.workerNonce, this.workerOffset);
        }
        return cnUtil.convert_blob(this.buffer).toString('hex');
    };
}

function MasterBlockTemplate(template){
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
    if (typeof(this.workerOffset) === 'undefined'){
        this.solo = true;
        global.instanceId.copy(this.buffer, this.reservedOffset + 4, 0, 3);
        this.buffer.copy(this.previousHash, 0, 7, 39);
    }
    this.blobForWorker = function(){
        this.buffer.writeUInt32BE(++this.poolNonce, this.poolOffset);
        return this.buffer.toString('hex');
    };
}

function getJob(miner){
    let activeBlockTemplate = miner.activeBlockTemplate();
    if (miner.lastBlockHeight === activeBlockTemplate.height && !miner.newDiff && miner.cachedJob !== null) {
        return miner.cachedJob;
    }

    let blob = activeBlockTemplate.nextBlob();
    let target = getTargetHex();
    miner.lastBlockHeight = activeBlockTemplate.height;

    let newJob = {
        id: crypto.pseudoRandomBytes(21).toString('base64'),
        extraNonce: activeBlockTemplate.workerNonce,
        height: activeBlockTemplate.height,
        difficulty: miner.difficulty,
        diffHex: miner.diffHex,
        submissions: []
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

function getTargetHex (miner) {
    if (miner.newDiff) {
        miner.difficulty = miner.newDiff;
        miner.newDiff = null;
    }
    let padded = new Buffer(32);
    padded.fill(0);
    let diffBuff = baseDiff.div(miner.difficulty).toBuffer();
    diffBuff.copy(padded, 32 - diffBuff.length);

    let buff = padded.slice(0, 4);
    let buffArray = buff.toByteArray().reverse();
    let buffReversed = new Buffer(buffArray);
    miner.target = buffReversed.readUInt32BE(0);
    return buffReversed.toString('hex');
}

function processShare (miner, job, blockTemplate, nonce, resultHash){
    let template = new Buffer(blockTemplate.buffer.length);
    blockTemplate.buffer.copy(template);
    template.writeUInt32BE(job.extraNonce, blockTemplate.reservedOffset);
    let hash = new Buffer(resultHash, 'hex');
    let hashArray = hash.toByteArray().reverse();
    let hashNum = bignum.fromBuffer(new Buffer(hashArray));
    let hashDiff = baseDiff.div(hashNum);

    if (hashDiff.ge(blockTemplate.difficulty)) {
        // Validate share with CN hash, then if valid, blast it up to the master.
        let shareBuffer = global.coinFuncs.constructNewBlob(template, new Buffer(nonce, 'hex'));
        let convertedBlob = global.coinFuncs.convertBlob(shareBuffer);
        hash = global.coinFuncs.cryptoNight(convertedBlob);
        if (hash.toString('hex') !== resultHash) {
            console.error(global.threadName + "Bad block from miner " + miner.logString);
            return miner.messageSender('job', miner.getJob());
        }
        miner.blocks += 1;
        process.send({
            type: 'blockFind',
            host: miner.pool,
            data:{
                nonce: nonce,
                resultHash: resultHash,
                workerNonce: blockTemplate.workerNonce
            }
        });
    }
    else if (hashDiff.lt(job.difficulty)) {
        process.send({type: 'invalidShare'});
        console.warn(global.threadName + "Rejected low diff share of " + hashDiff.toString() + " from: " + miner.address + " ID: " +
            miner.identifier + " IP: " + miner.ipAddress);
        return false;
    } else if (hashDiff.ge(blockTemplate.targetDiff)){
        process.send({
            type: 'shareFind',
            host: miner.pool,
            data:{
                nonce: nonce,
                resultHash: resultHash,
                workerNonce: blockTemplate.workerNonce
            }
        });
    }
    miner.shares += 1;
    miner.hashes += job.difficulty;
    return true;
}

module.exports = function () {
    return {
        developerAddy: '44Ldv5GQQhP7K7t3ZBdZjkPA7Kg7dhHwk3ZM3RJqxxrecENSFx27Vq14NAMAd2HBvwEPUVVvydPRLcC69JCZDHLT2X5a4gr',
        hashSync: multiHashing.cryptonight,
        hashAsync: multiHashing.CNAsync,
        blockHeightCheck: blockHeightCheck,
        getRemoteNodes: getRemoteNodes,
        BlockTemplate: BlockTemplate,
        getJob: getJob,
        getTargetHex: getTargetHex,
        processShare: processShare,
        MasterBlockTemplate: MasterBlockTemplate
    };
};