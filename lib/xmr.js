"use strict";
const multiHashing = require('cryptonight-hashing');
const cnUtil = require('cryptoforknote-util');
const bignum = require('bignum');
const support = require('./support.js')();

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

function blobTypeGrin(blob_type_num) {
    switch (blob_type_num) {
        case 8:
        case 9:
        case 10:
        case 12: return true;
        default: return false;
    }
}

function nonceSize(blob_type_num) {
    return blob_type_num == 7 ? 8 : 4;
} 

function blobTypeDero(blob_type_num) {
    return blob_type_num == 100;
}

function blobTypeHaven(blob_type_num) {
    return blob_type_num == 101;
}

function c29ProofSize(blob_type_num) {
    switch (blob_type_num) {
        case 10: return 40;
        case 12: return 48;
        default: return 32;
    }
}

function convertBlob(blobBuffer, blob_type_num){
    if (blobTypeDero(blob_type_num)) return blobBuffer;
    return cnUtil.convert_blob(blobBuffer, blob_type_num);
}

function constructNewBlob(blockTemplate, NonceBuffer, blob_type_num, ring){
    if (blobTypeDero(blob_type_num)) {
        NonceBuffer.copy(blockTemplate, 39, 0, 4);
        return blockTemplate;
    } else {
        return cnUtil.construct_block_blob(blockTemplate, NonceBuffer, blob_type_num, ring);
    }
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
        case 'cryptonote3':     return 6; // Masari
        case 'aeon':            return 7; // Aeon
        case 'cuckaroo':        return 8; // Swap/MoneroV
        case 'cryptonote_xtnc': return 9; // XTNC
        case 'cryptonote_tube': return 10; // Tube
        case 'cryptonote_xhv':  return 11; // Haven
        case 'cryptonote_xta':  return 12; // Italo
        case 'cryptonote_dero': return 100; // Dero
    }
    return 0;
}

// Names are taken from https://github.com/xmrig/xmrig-proxy/blob/master/doc/STRATUM_EXT.md

function hash_func(convertedBlob, blockTemplate) {
    const block_version = typeof(blockTemplate.blocktemplate_blob) !== 'undefined' ? 16 * parseInt(blockTemplate.blocktemplate_blob[0]) + parseInt(blockTemplate.blocktemplate_blob[1]) : 0;
    const algo2         = typeof(blockTemplate.algo) === 'undefined' ? "rx/0" : blockTemplate.algo;
    switch (algo2) {
        case 'rx/0':                   return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 0);

        case 'cn':
        case 'cryptonight':
        case 'cn/0':
        case 'cryptonight/0':          return multiHashing.cryptonight(convertedBlob, 0);

        case 'cn/1':
        case 'cryptonight/1':          return multiHashing.cryptonight(convertedBlob, 1);

        case 'cn/xtl':
        case 'cryptonight/xtl':        return multiHashing.cryptonight(convertedBlob, 3);

        case 'cn/msr':
        case 'cryptonight/msr':        return multiHashing.cryptonight(convertedBlob, 4);

        case 'cn/xao':
        case 'cryptonight/xao':        return multiHashing.cryptonight(convertedBlob, 6);

        case 'cn/rto':
        case 'cryptonight/rto':        return multiHashing.cryptonight(convertedBlob, 7);

        case 'cn/2':
        case 'cryptonight/2':          return multiHashing.cryptonight(convertedBlob, 8);

        case 'cn/half':
        case 'cryptonight/half':       return multiHashing.cryptonight(convertedBlob, 9);

        case 'cn/gpu':
        case 'cryptonight/gpu':        return multiHashing.cryptonight(convertedBlob, 11);

        case 'cn/wow':
        case 'cryptonight/wow':        return multiHashing.cryptonight(convertedBlob, 12, blockTemplate.height);

        case 'cn/r':
        case 'cryptonight/r':          return multiHashing.cryptonight(convertedBlob, 13, blockTemplate.height);

        case 'cn/rwz':
        case 'cryptonight/rwz':        return multiHashing.cryptonight(convertedBlob, 14);

        case 'cn/zls':
        case 'cryptonight/zls':        return multiHashing.cryptonight(convertedBlob, 15);

        case 'cn/ccx':
        case 'cryptonight/ccx':        return multiHashing.cryptonight(convertedBlob, 17);

        case 'cn/double':
        case 'cryptonight/double':     return multiHashing.cryptonight(convertedBlob, 16);

        case 'cn-lite':
        case 'cryptonight-lite':
        case 'cn-lite/0':
        case 'cryptonight-lite/0':     return multiHashing.cryptonight_light(convertedBlob, 0);

        case 'cn-lite/1':
        case 'cryptonight-lite/1':     return multiHashing.cryptonight_light(convertedBlob, 1);

        case 'cn-heavy':
        case 'cryptonight-heavy':
        case 'cn-heavy/0':
        case 'cryptonight-heavy/0':    return multiHashing.cryptonight_heavy(convertedBlob, 0);

        case 'cn-heavy/xhv':
        case 'cryptonight-heavy/xhv':  return multiHashing.cryptonight_heavy(convertedBlob, 1);

        case 'cn-heavy/tube':
        case 'cryptonight-heavy/tube': return multiHashing.cryptonight_heavy(convertedBlob, 2);

        case 'cn-pico/trtl':
        case 'cryptonight-pico/trtl':  return multiHashing.cryptonight_pico(convertedBlob, 0);

        case 'rx/wow':
        case 'randomx/wow':            return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 17);

        case 'rx/loki':
        case 'randomx/loki':           return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 18);

        case 'rx/v':                   return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 19);

        case 'defyx':                  return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 1);

        case 'panthera':               return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 3);

        case 'rx/arq':                 return multiHashing.randomx(convertedBlob, Buffer.from(blockTemplate.seed_hash, 'hex'), 2);

        case 'argon2/chukwav2':
        case 'chukwav2':               return multiHashing.argon2(convertedBlob, 2);

        case 'argon2/wrkz':            return multiHashing.argon2(convertedBlob, 1);

        case 'k12':                    return multiHashing.k12(convertedBlob);

        case 'astrobwt':               return multiHashing.astrobwt(convertedBlob, 0);
    }
    return "";
}

function hash_func_c29(algo, header, ring) {
    switch (algo) {
        case 'c29s': return multiHashing.c29s(header, ring);
        case 'c29v': return multiHashing.c29v(header, ring);
        case 'c29b': return multiHashing.c29b(header, ring);
        case 'c29i': return multiHashing.c29i(header, ring);
        default: return 1;
    }
}

function detectAlgo(default_pool_algo_set, block_version) {
    if ("cn/r" in default_pool_algo_set && "rx/0" in default_pool_algo_set) return block_version >= 12 ? "rx/0" : "cn/r"; // Monero fork
    const default_pool_algo_arr = Object.keys(default_pool_algo_set);
    if (default_pool_algo_arr.length == 1) return default_pool_algo_arr[0];
    console.error("Can't not correctly detect block template algorithm from the list of provided default algorithms (please reduce it to single item): " + default_pool_algo_arr.join(", "));
    return default_pool_algo_arr[0];
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
    this.seed_hash = template.seed_hash;
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
        return convertBlob(this.buffer, this.blob_type).toString('hex');
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
    this.seed_hash = template.seed_hash;
    this.reservedOffset = template.reserved_offset;  // reserveOffset
    this.workerOffset = template.client_nonce_offset; // clientNonceLocation
    this.poolOffset = template.client_pool_offset; // clientPoolLocation
    if (!("client_pool_offset" in template)) console.error("Your pool is not compatible with xmr-node-proxy!");
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

    const blob = activeBlockTemplate.nextBlob();
    adjustMinerDiff(miner, activeBlockTemplate.targetDiff);
    miner.lastBlockHeight = activeBlockTemplate.height;

    let newJob = {
        id: support.get_new_id(),
        blob_type: activeBlockTemplate.blob_type,
        extraNonce: activeBlockTemplate.workerNonce,
        height: activeBlockTemplate.height,
        seed_hash: activeBlockTemplate.seed_hash,
        difficulty: miner.difficulty,
        diffHex: miner.diffHex,
        submissions: [],
        templateID: activeBlockTemplate.id
    };

    miner.validJobs.enq(newJob);

    if (blobTypeGrin(activeBlockTemplate.blob_type)) miner.cachedJob = {
        pre_pow:    blob,
        algo:       "cuckaroo",
        edgebits:   29,
        proofsize:  c29ProofSize(activeBlockTemplate.blob_type),
	noncebytes: 4,
        height:     activeBlockTemplate.height,
        job_id:     newJob.id,
        difficulty: miner.difficulty,
        id:         miner.id
    }; else miner.cachedJob = {
        blob:       blob,
        job_id:     newJob.id,
        height:     activeBlockTemplate.height,
        seed_hash:  activeBlockTemplate.seed_hash,
        target:     getTargetHex(miner.difficulty, nonceSize(activeBlockTemplate.blob_type)),
        id:         miner.id
    };
    if (typeof (activeBlockTemplate.variant) !== 'undefined') {
        miner.cachedJob.variant = activeBlockTemplate.variant;
    }
    if (typeof (activeBlockTemplate.algo) !== 'undefined' && miner.protocol !== "grin") {
        miner.cachedJob.algo = activeBlockTemplate.algo;
    }
    return miner.cachedJob;
}

function getMasterJob(pool, workerID) {
    let activeBlockTemplate = pool.activeBlocktemplate;
    let btBlob = activeBlockTemplate.blobForWorker();
    let workerData = {
        id: support.get_new_id(),
        blocktemplate_blob: btBlob,
        blob_type: activeBlockTemplate.blob_type,
        variant: activeBlockTemplate.variant,
        algo: activeBlockTemplate.algo,
        difficulty: activeBlockTemplate.difficulty,
        height: activeBlockTemplate.height,
        seed_hash: activeBlockTemplate.seed_hash,
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

function adjustMinerDiff(miner, max_diff) {
    if (miner.newDiff) {
        miner.difficulty = miner.newDiff;
        miner.newDiff = null;
    }
    if (miner.difficulty > max_diff) {
        miner.difficulty = max_diff;
    }
}

function getTargetHex(difficulty, size) {
    let padded = new Buffer(32);
    padded.fill(0);
    const diffBuff = baseDiff.div(difficulty).toBuffer();
    diffBuff.copy(padded, 32 - diffBuff.length);
    const buff = padded.slice(0, size);
    const buffArray = buff.toByteArray().reverse();
    const buffReversed = new Buffer(buffArray);
    return buffReversed.toString('hex');
};

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

function hash_buff_diff(hash) {
    return baseDiff.div(bignum.fromBuffer(new Buffer(hash.toByteArray().reverse())));
}

function processShare(miner, job, blockTemplate, params) {
    const blob_type = job.blob_type;
    const nonce     = params.nonce;

    let template = new Buffer(blockTemplate.buffer.length);
    blockTemplate.buffer.copy(template);
    if (blockTemplate.solo) {
        template.writeUInt32BE(job.extraNonce, blockTemplate.reservedOffset);
    } else {
        template.writeUInt32BE(job.extraNonce, blockTemplate.workerOffset);
    }

    const hashDiff = hash_buff_diff(blobTypeGrin(blob_type) ? multiHashing.c29_cycle_hash(params.pow) : new Buffer(params.result, 'hex'));

    if (hashDiff.ge(blockTemplate.targetDiff)) {
        let time_now = Date.now();
        if (!verified_share_start_period || time_now - verified_share_start_period > VER_SHARES_PERIOD*1000) {
            verified_share_num = 0;
            verified_share_start_period = time_now;
        }
        let isVerifyFailed = false;

        if (blobTypeGrin(blob_type)) {
            const shareBuffer = constructNewBlob(template, bignum(nonce, 10).toBuffer({endian: 'little', size: 4}), blob_type, params.pow)
            const header = Buffer.concat([convertBlob(shareBuffer, blob_type), bignum(nonce, 10).toBuffer({endian: 'big', size: 4})]);
            if (hash_func_c29(blockTemplate.algo, header, params.pow)) isVerifyFailed = true;
        } else {
            if (++ verified_share_num <= MAX_VER_SHARES_PER_SEC*VER_SHARES_PERIOD) {
                // Validate share with CN hash, then if valid, blast it up to the master.
                const shareBuffer = constructNewBlob(template, new Buffer(nonce, 'hex'), blob_type);
                const convertedBlob = convertBlob(shareBuffer, blob_type);
                const hash = hash_func(convertedBlob, blockTemplate);
                if (hash.toString('hex') !== params.result) isVerifyFailed = true;
            } else {
                console.error(global.threadName + "Throttling down miner share verification to avoid CPU overload: " + miner.logString);
            }
        }
        if (isVerifyFailed) {
           console.error(global.threadName + "Bad share from miner " + miner.logString);
            miner.pushMessage({method: 'job', params: miner.getNewJob(true)});
            return false;
        }
        miner.blocks += 1;
        const poolName = miner.pool;
        process.send({
            type: 'shareFind',
            host: poolName,
            data: {
                btID: blockTemplate.id,
                nonce: nonce,
                pow: params.pow,
                resultHash: params.result,
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
    "username": "89TxfrUmqJJcb1V124WsUzA78Xa3UYHt7Bg8RGMhXVeZYPN8cE5CZEk58Y1m23ZMLHN7wYeJ9da5n5MXharEjrm41hSnWHL",
    "password": "proxy_donations",
    "keepAlive": true,
    "coin": "xmr",
    "default": false,
    "devPool": true
};

module.exports = function () {
    return {
        devPool: devPool,
        blobTypeGrin: blobTypeGrin,
        hashSync: multiHashing.cryptonight,
        hashAsync: multiHashing.cryptonight_async,
        blockHeightCheck: blockHeightCheck,
        getRemoteNodes: getRemoteNodes,
        BlockTemplate: BlockTemplate,
        getJob: getJob,
        c29ProofSize: c29ProofSize,
        nonceSize: nonceSize,
        processShare: processShare,
        MasterBlockTemplate: MasterBlockTemplate,
        getMasterJob: getMasterJob,
        detectAlgo: detectAlgo
    };
};
