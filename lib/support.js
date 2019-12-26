"use strict";
const CircularBuffer = require('circular-buffer');
const request = require('request');
const debug = require('debug')('support');
const fs = require('fs');

function get_new_id() {
    const min = 100000000000000;
    const max = 999999999999999;
    const id = Math.floor(Math.random() * (max - min + 1)) + min;
    return id.toString();
};

function human_hashrate(hashes, algo) {
    const power = Math.pow(10, 2 || 0);
    const unit = algo === "c29s" || algo === "c29v" ? "G" : "H";
    if (algo === "c29s") hashes *= 32;
    if (algo === "c29v") hashes *= 16;
    if (hashes > 1000000000000) return String(Math.round((hashes / 1000000000000) * power) / power) +  " T" + unit + "/s";
    if (hashes > 1000000000)    return String(Math.round((hashes / 1000000000) * power) / power) +  " G" + unit + "/s";
    if (hashes > 1000000)       return String(Math.round((hashes / 1000000) * power) / power) +  " M" + unit + "/s";
    if (hashes > 1000)          return String(Math.round((hashes / 1000) * power) / power) +  " K" + unit + "/s";
    return ( hashes || 0.0 ).toFixed(2) + " " + unit + "/s"
};

function circularBuffer(size) {
    let buffer = CircularBuffer(size);

    buffer.sum = function () {
        if (this.size() === 0) {
            return 1;
        }
        return this.toarray().reduce(function (a, b) {
            return a + b;
        });
    };

    buffer.average = function (lastShareTime) {
        if (this.size() === 0) {
            return global.config.pool.targetTime * 1.5;
        }
        let extra_entry = (Date.now() / 1000) - lastShareTime;
        return (this.sum() + Math.round(extra_entry)) / (this.size() + 1);
    };

    buffer.clear = function () {
        let i = this.size();
        while (i > 0) {
            this.deq();
            i = this.size();
        }
    };

    return buffer;
}

function sendEmail(toAddress, subject, body){
    request.post(global.config.general.mailgunURL + "/messages", {
        auth: {
            user: 'api',
            pass: global.config.general.mailgunKey
        },
        form: {
            from: global.config.general.emailFrom,
            to: toAddress,
            subject: subject,
            text: body
        }
    }, function(err, response, body){
        if (!err && response.statusCode === 200) {
            console.log("Email sent successfully!  Response: " + body);
        } else {
            console.error("Did not send e-mail successfully!  Response: " + body + " Response: "+JSON.stringify(response));
        }
    });
}

function coinToDecimal(amount) {
    return amount / global.config.coin.sigDigits;
}

function decimalToCoin(amount) {
    return Math.round(amount * global.config.coin.sigDigits);
}

function blockCompare(a, b) {
    if (a.height < b.height) {
        return 1;
    }

    if (a.height > b.height) {
        return -1;
    }
    return 0;
}

function tsCompare(a, b) {
    if (a.ts < b.ts) {
        return 1;
    }

    if (a.ts > b.ts) {
        return -1;
    }
    return 0;
}

function currentUnixTimestamp(){
    return + new Date();
}

module.exports = function () {
    return {
        get_new_id: get_new_id, 
        human_hashrate: human_hashrate,
        circularBuffer: circularBuffer,
        coinToDecimal: coinToDecimal,
        decimalToCoin: decimalToCoin,
        blockCompare: blockCompare,
        sendEmail: sendEmail,
        tsCompare: tsCompare,
        developerAddy: '44Ldv5GQQhP7K7t3ZBdZjkPA7Kg7dhHwk3ZM3RJqxxrecENSFx27Vq14NAMAd2HBvwEPUVVvydPRLcC69JCZDHLT2X5a4gr',
        currentUnixTimestamp: currentUnixTimestamp
    };
};
