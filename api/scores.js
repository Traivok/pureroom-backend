'use strict';

const express = require('express');

const router = express.Router();

const { InfluxDB }                    = require('@influxdata/influxdb-client');
const { influx: { url, token, org } } = require('../env');
const { from, map, take }             = require('rxjs');

const queryApi  = new InfluxDB({ url, token }).getQueryApi(org);
const fluxQuery = `from(bucket: "ubiquarium")
  |> range(start: -1d)
  |> filter(fn: (r) => r["measurement"] == "temperature" or r["measurement"] == "co2" or r["measurement"] == "humidity")
  |> filter(fn: (r) => r["location"] == "t1_1_ubiquarium_stand1")
  |> filter(fn: (r) => r["protocol"] == "netatmo") 
  |> yield(name: "last")`;


function makeHan () {
        let arr   = [];
        return new Promise((resolve, reject) => {
            const sub = from(queryApi.rows(fluxQuery))
                .pipe(map(({ values, tableMeta }) => tableMeta.toObject(values)))
                .subscribe({
                    next(o) {
                        console.log(o);
                        console.log ("GOOOOO")
                    }, error(e) {
                        console.error(e);
                        reject(e)
                    }, complete() {
                        resolve(arr);
                        // console.log('\nFinished SUCCESS');
                    },
                });
        })

    }

function formula(temp, hum, co2) {
    return Math.floor((temp+hum+co2)/3);
}


var myLogger = async function (req, res) {
    const arrTemp = await makeHan();
    /*let arr = [];
    console.log(arrTemp[23].time);
    console.log(arrHum[23].time);
    console.log(arrCo2[23].time);
    for(let i = 0; i < arrTemp.length; i++) {
        arr = [ ...arr, { value: formula(arrTemp[i].value,arrHum[i].value,arrCo2[i].value), time: arrTemp[i].time} ];
    }
    return arr;*/
};



// GET /scoring
router.get('/scores', (req, res) => {
    myLogger().then(data => res.send(data))
    res.send([ { value: 0, time: Date.now() }]);
});

module.exports = router;
