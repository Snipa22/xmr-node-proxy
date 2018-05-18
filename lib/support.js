"use strict";
const CircularBuffer = require('circular-buffer');
const request = require('request');
const debug = require('debug')('support');
const fs = require('fs');

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
