'use strict';

const express = require('express');

const router = express.Router();

const { InfluxDB }                    = require('@influxdata/influxdb-client');
const { influx: { url, token, org } } = require('../env');
const { from, map }                   = require('rxjs');

const queryApi  = new InfluxDB({ url, token }).getQueryApi(org);
const fluxQuery = `from(bucket: "ubiquarium")
  |> range(start: -1d)
  |> filter(fn: (r) => r["measurement"] == "temperature" or r["measurement"] == "co2" or r["measurement"] == "humidity")
  |> filter(fn: (r) => r["location"] == "t1_1_ubiquarium_stand1")
  |> filter(fn: (r) => r["protocol"] == "netatmo") 
  |> yield(name: "last")`;


function makeHan() {
    let arrCo2  = [];
    let arrHum  = [];
    let arrTemp = [];
    let arr     = [];
    return new Promise((resolve, reject) => {
        const sub = from(queryApi.rows(fluxQuery))
            .pipe(map(({ values, tableMeta }) => tableMeta.toObject(values)))
            .subscribe({
                next(o) {
                    if (o.category === 'humidity') arrHum = [
                        ...arrHum, { value: o._value, time: new Date(o._time).getTime() },
                    ];
                    if (o.category === 'temperature') arrTemp = [
                        ...arrTemp, { value: o._value, time: new Date(o._time).getTime() },
                    ];
                    if (o.category === 'carbondioxide') arrCo2 = [
                        ...arrCo2, {
                            value: o._value, time: new Date(o._time).getTime(),
                        },
                    ];
                }, error(e) {
                    console.error(e);
                    sub.unsubscribe();
                    reject(e);
                }, complete() {
                    arr.push(arrTemp);
                    arr.push(arrHum);
                    arr.push(arrCo2);
                    sub.unsubscribe();
                    resolve(arr);
                },
            });
    });

}

function formula(temp, hum, co2) {
    return Math.floor((temp + hum + co2) / 3);
}

const myLogger = async function () {
    let arr = await makeHan();
    let tab = [];
    for (let i = 0; i < arr[0].length; i++) {
        tab = [ ...tab, { value: formula(arr[0][i].value, arr[1][i].value, arr[2][i].value), time: arr[0][i].time } ];
    }
    return tab;
};


// GET /scoring
router.get('/scores', (req, res) => {
    myLogger().then(data => res.send(data));
});

module.exports = router;
