'use strict';

const express = require('express');

const router = express.Router();

const { InfluxDB, FluxTableMetaData } = require('@influxdata/influxdb-client');
const { influx: { url, token, org } } = require('../env');
const { from, map, take }             = require('rxjs');

const queryApi  = new InfluxDB({ url, token }).getQueryApi(org);
const fluxQuery = (measurement) => `from(bucket: "ubiquarium")
  |> range(start: -1d)
  |> filter(fn: (r) => r["measurement"] == "${ measurement }")
  |> filter(fn: (r) => r["location"] == "t1_1_ubiquarium_stand1")
  |> filter(fn: (r) => r["protocol"] == "netatmo") 
  |> yield(name: "last")`;
const fluxQuery_humidity_and_temperature_measurement = () => `from(bucket: "ubiquarium")
  |> range(start: -1d)
  |> filter(fn: (r) => r["measurement"] == "humidity" or r["measurement"] == "temperature")
  |> filter(fn: (r) => r["location"] == "t1_1_ubiquarium_stand1")
  |> filter(fn: (r) => r["protocol"] == "netatmo") 
  |> yield(name: "last")`;

const getMeasurement = (measurement) => new Promise((resolve, reject) => {
    let arr = []
    const sub = from(queryApi.rows(fluxQuery(measurement)))
        .pipe(map(({ values, tableMeta }) => tableMeta.toObject(values)))
        .subscribe({
            next(o) {
                arr = [ ...arr, { value: o._value, time: new Date(o._time).getTime() } ];
            }, error(e) {
                console.error(e)
                reject(e)
            }, complete() {
                resolve(arr)
                sub.unsubscribe();
            },
        });
})

const getHumidityAndTemperature = new Promise((resolve, reject) => {
    let humidity   = []
    let temperature   = []
    let result = {
        humidity: humidity,
        temperature: temperature
    }
    const sub = from(queryApi.rows(fluxQuery_humidity_and_temperature_measurement()))
        .pipe(map(({ values, tableMeta }) => tableMeta.toObject(values)))
        .subscribe({
            next(o) {
                switch (o.measurement){
                    case 'humidity': humidity.push({ value: o._value, time: o._time }); break
                    case 'temperature': temperature.push({ value: o._value, time: o._time }); break
                }
            }, error(e) {
                console.error(e);
                reject(e)
            }, complete() {
                resolve(result)
                sub.unsubscribe();
            },
        });
});

const makeHandker = (measurement) => (req, res) => {
    getMeasurement(measurement)
        .then(result=>{
            res.send(result)
        })
        .catch(err=>{
            throw(err)
        })
};

const getDewPoint = async() => {
    let dew_point = []
    await getHumidityAndTemperature.then(obj=>{
        for(let i=0; i<obj.humidity.length; i++){
            let dew_point_value = obj.temperature[i].value - (100 - obj.humidity[i].value)/5
            dew_point.push({ value: dew_point_value, time: obj.humidity[i].time, status: dew_point_status_celsius(dew_point_value)})
        }
    })
    return dew_point
}

const getHumidex = async () => {
    let humidex = []
    await getHumidityAndTemperature.then(obj=>{
        for(let i=0; i<obj.humidity.length; i++){
            let dew_point_value = obj.temperature[i].value - (100 - obj.humidity[i].value)/5
            let humidex_value = obj.temperature[i].value + 5/9*(6.11 * Math.pow(2.71828, (5417.7530*(1/273.16 - 1/(273.15+dew_point_value)))))
            humidex.push({ value: humidex_value, time: obj.humidity[i].time, status: humidex_status(humidex_value)})
        }
    })
    return humidex
};

const getHeatIndex = async () => {
    let heat_index = []

    await getHumidityAndTemperature.then(obj=>{
        let T = obj.temperature
        let R = obj.humidity
        for(let i=0; i<obj.humidity.length; i++){
            let c = [
                -8.78469475556,
                1.61139411,
                2.33854883889,
                -0.14611605,
                -0.012308094,
                -0.0164248277778,
                0.002211732,
                0.00072546,
                -0.000003582,
            ]

            let heat_index_value =
                c[0]+
                c[1]*T[i].value +
                c[2]*R[i].value +
                c[3]*T[i].value*R[i].value +
                c[4]*Math.pow(T[i].value, 2) +
                c[5]*Math.pow(R[i].value, 2) +
                c[6]*Math.pow(T[i].value, 2) *R[i].value +
                c[7]*T[i].value *Math.pow(R[i].value, 2) +
                c[8]*Math.pow(T[i].value, 2) *Math.pow(R[i].value, 2)

            heat_index.push({ value: heat_index_value, time: obj.humidity[i].time, status: heat_index_status(heat_index_value)})
        }
    })
    return heat_index
};

const getIndoorCo2Level = async () => {
    let indoor_co2 = []
    await getMeasurement('co2').then(arr=>{
        for(let i=0; i<arr.length; i++){
            indoor_co2.push({ value: arr[i].value, time: arr[i].time, status: indoor_co2_status(arr[i].value)})
        }
    })
    return indoor_co2
};

const getFinalScore = async () =>{
    let dew_point = await getDewPoint()
    let humidex = await getHumidex()
    let heat_index = await getHeatIndex()
    let indoor_co2 = await getIndoorCo2Level()
    let final_score = (dew_point[dew_point.length-1].status.score+ humidex[humidex.length-1].status.score + heat_index[heat_index.length-1].status.score + indoor_co2[indoor_co2.length-1].status.score)/4
    return {value: final_score}
};

const dew_point_status_celsius = (dew_point_value) => {
    if(dew_point_value < 5) return {code: 0, value: "very dry", score: 30}
    else if(dew_point_value >= 5 && dew_point_value < 10 ) return {code: 1, value: "dry", score: 60}
    else if(dew_point_value >= 10 && dew_point_value < 15 ) return {code: 2, value: "confortable", score: 100}
    else if(dew_point_value >= 15 && dew_point_value < 24 ) return {code: 3, value: "begin muggy", score: 60}
    else if(dew_point_value >= 20 && dew_point_value < 24 ) return {code: 4, value: "muggy", score: 30}
    else return {code: 5, value: "uncomfortable", score: 0}
}

const humidex_status = (humidex_value) => {
    if(humidex_value < 15) return {code: 0, value: "fresh", score: 80}
    else if(humidex_value >= 5 && humidex_value < 10 ) return {code: 1, value: "dry", score: 90}
    else if(humidex_value >= 15 && humidex_value < 29 ) return {code: 2, value: "confortable", score: 100}
    else if(humidex_value >= 30 && humidex_value < 39 ) return {code: 3, value: "uncomfortable", score: 20}
    else if(humidex_value >= 40 && humidex_value < 53 ) return {code: 4, value: "danger", score: 10}
    else return {code: 5, value: "extreme", score: 0}
}

const heat_index_status = (heat_index_value) => {
    if(heat_index_value < 26) return {code: 0, value: "confortable", score: 100}
    else if(heat_index_value >= 26 && heat_index_value < 31 ) return {code: 1, value: "caution", score: 20}
    else if(heat_index_value >= 31 && heat_index_value < 51 ) return {code: 2, value: "uncomfortable", score: 10}
    else return {code: 3, value: "danger", score: 0}
}

const indoor_co2_status = (indoor_co2_value) => {
    if(indoor_co2_value < 600) return {code: 0, value: "excellent", score: 100}
    else if(indoor_co2_value >= 600 && indoor_co2_value < 1000 ) return {code: 1, value: "confortable", score: 90}
    else if(indoor_co2_value >= 1000 && indoor_co2_value < 1500 ) return {code: 2, value: "unconfortable", score: 10}
    else return {code: 3, value: "danger", score: 0}
}


router.get('/dewpoint', async (req, res) => {res.send(await getDewPoint())})
router.get('/humidex', async (req, res) => res.send(await getHumidex()))
router.get('/heatindex', async (req, res) => res.send(await getHeatIndex()))
router.get('/indoorco2', async (req, res) => res.send(await getIndoorCo2Level()))
router.get('/finalscore', async (req, res) => res.send(await getFinalScore()))

// GET /weather/humidity
// GET /weather/co2
// GET /weather/temperature
for (const measure of [ 'humidity', 'co2', 'temperature' ]) {
    router.get('/weather/' + measure, makeHandker(measure));
}

module.exports = router;
