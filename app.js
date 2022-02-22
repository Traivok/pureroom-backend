const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const logger       = require('morgan');
const cors         = require('cors');
require('dotenv').config();

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({ origin: '*' }));

app.use('/weather', require('./api/influxdb'));
//app.use('/scores', require('./api/scores'));

const port = 8081;
app.listen(8081);
console.log('APP LISTENING ON', port);

app.get('/', (req, res) => {
    console.log('Index')
    res.sendFile(__dirname + '/public/index.html');
});

module.exports = app;
