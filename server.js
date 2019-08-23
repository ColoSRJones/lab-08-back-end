'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const superagent = require('superagent');
const pg = require('pg');

const client = new pg.Client(process.env.DATABASE_URL);
client.connect();

const app = express();
app.use(cors());

app.get('/location', getLocation);
app.get('/events', getEvents);
app.get('/weather', getWeather);
app.get('/yelp', getYelps);
app.get('/movies', getMovies);

const timeouts = {
	weather: 15000,
	yelp: 15000,
	movies: 15000,
	events: 15000,
}

function convertTime(timeInMilliseconds) {
	return new Date(timeInMilliseconds).toString().slice(0, 15);
}

function Location(query, geoData) {
	this.search_query = query;
	this.formatted_query = geoData.results[0].formatted_address;
	this.latitude = geoData.results[0].geometry.location.lat;
	this.longitude = geoData.results[0].geometry.location.lng;
}

Location.prototype.save = function () {
	const SQL = 'INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;';
	const VALUES = [this.search_query, this.formatted_query, this.latitude, this.longitude];

	return client.query(SQL, VALUES).then(result => {
		this.id = result.rows[0].id;
		return this;
	})
}

function Weather(weatherData) {
	this.created_at = Date.now();
	this.forecast = weatherData.summary;
	this.time = convertTime(weatherData.time * 1000);
}

Weather.prototype.save = function (location_id) {
	const SQL = 'INSERT INTO weather (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4)';

	const VALUES = [this.forecast, this.time, this.created_at, this.location_id];

	client.query(SQL, VALUES);
}

function Event(query, url, name, date, summary) {
	this.search_query = query;
	this.link = url;
	this.name = name;
	this.event_date = date;
	this.summary = summary;
}

function handleError(error, response) {
	response.status(error.status || 500).send(error.message);
}

function deleteData(tableName, location_id){
	const SQL = 'DELETE FROM ${table} WHERE location_id=$1'
	const VALUES = [location_id];
	return client.query(SQL, VALUES);
}

function lookupData(lookupHandler) {
	const SQL = `SELECT * FROM ${lookupHandler.tableName} WHERE ${lookupHandler.column}=$1`
	const VALUES = [lookupHandler.query]

	client.query(SQL, VALUES).then(result => {
		if (result.rowCount === 0) {
			lookupHandler.cacheMiss();
		} else {
			lookupHandler.cacheHit(result);
		}
	})
}

function getLocation(req, res) {
	lookupData({
		tableName: 'locations',
		column: 'search_query',
		query: req.query.data,

		cacheHit: function (result) {
			res.send(result.rows[0]);
		},

		cacheMiss: function () {
			const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GEOCODE_API_KEY}`;

			superagent.get(url)
				.then(geoData => {
					const location = new Location(this.query, geoData.body);
					location.save().then(location => res.send(location));
				})
		}
	})
}

function getWeather(req, res) {
	lookupData({
		tableName: 'weather',
		column: 'location_id',
		query: req.query.data.location_id,

		cacheHit: function () {
			let ageOfResults = (Date.now() - res.rows[0].created_at);
			if (ageOfResults > timeouts.weather) {
				deleteData('weather', req.query.data.location_id).then(() => {
					this.cacheMiss();
				})

			} else {
				res.send(res.rows);
			}
		},

		cacheMiss: function () {
			const url = 'https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}'

			superagent.get(url)
				.then(weatherData => {
					const weatherSummaries = weatherData.body.daily.data.map(day) => {
						const summary = new Weather(day);
						summary.save(req.query.data.id);
						return summary;
					}
				});
			res.send(weatherSummaries);
		}
	})
}

function getEvents(req, res) {

}

function getYelps(req, res) {

}

function getMovies(req, res) {

}



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log('Server has started...');
});