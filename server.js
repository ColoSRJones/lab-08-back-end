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

const timeouts = {
	weather: 15000,
	yelp: 15000,
	movie: 15000,
	event: 15000,
}

app.get('/location', getLocation);
app.get('/event', getEvent);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movie', getMovie);

function convertTime(timeInMilliseconds) {
	return new Date(timeInMilliseconds).toString().slice(0, 15);
}
function handleError(error, response) {
	response.status(error.status || 500).send(error.message);
}
function lookupData(lookupHandler) {
	const SQL = `SELECT * FROM ${lookupHandler.tableName} WHERE ${lookupHandler.column}=$1;`;
	const VALUES = [lookupHandler.query];

	client.query(SQL, VALUES).then(result => {
		if(result.rowCount === 0) {
			lookupHandler.cacheMiss();
		} 
		else {
			lookupHandler.cacheHit(result);
		}
	});
}

function deleteData(tableName, location_id) {
	const SQL = `DELETE FROM ${tableName} WHERE location_id=$1;`;
	const VALUES = [location_id];
	return client.query(SQL, VALUES);
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
	});
};

function Weather(weatherData) {
	this.created_at = Date.now();
	this.forecast = weatherData.summary;
	this.time = convertTime(weatherData.time * 1000);
}

Weather.prototype.save = function (location_id) {
	const SQL = 'INSERT INTO weather (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4);';
	const VALUES = [this.forecast, this.time, this.created_at, location_id];

	client.query(SQL, VALUES);
};

function Event(eventData) {
	this.created_at = Date.now();
	this.link = eventData.url;
	this.name = eventData.name.text;
	this.event_date = eventData.start.local;
	this.summary = eventData.description.text;
}

Event.prototype.save = function(location_id){
 const SQL = 'INSERT INTO event (link, name, event_date, summary, created_at, location_id) VALUES($1, $2, $3, $4, $5, $6)';
 const VALUES = [this.link, this.name, this.event_date, this.summary, this.created_at, location_id];
 client.query(SQL, VALUES);
};

function Yelp(yelpData) {
	this.created_at = Date.now();
	this.name = yelpData.name;
	this.image_url = yelpData.image_url;
	this.price = yelpData.price;
	this.rating = yelpData.rating;
	this.url = yelpData.url;
}
Yelp.prototype.save = function(location_id){
 const SQL = 'INSERT INTO yelp (name, image_url, price, rating, url, created_at, location_id) VALUES($1, $2, $3, $4, $5, $6, $7)';
 const VALUES = [this.name, this.image_url, this.price, this.rating, this.url, this.created_at, location_id];
 client.query(SQL, VALUES);
};


function Movie(movieData) {
	this.created_at = Date.now();
	this.title = movieData.title;
	this.overview = movieData.overview;
	this.average_votes = movieData.average_votes;
	this.total_votes = movieData.total_votes;
	this.image_url = `https://image.tmdb.org/t/p/w185_and_h278_bestv2/${movieData.poster_path}`;
	this.popularity = movieData.popularity;
	this.release_on = movieData.release_on
}
Movie.prototype.save = function(location_id){
 const SQL = 'INSERT INTO movie (title, overview, average_votes, total_votes, image_url, popularity, release_on created_at, location_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)';
 const VALUES = [this.title, this.overview, this.average_votes, this.total_votes, this.image_url, this.popularity, this.release_on,this.created_at, location_id];
 client.query(SQL, VALUES);
};

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
				});
		}
	});
}

function getWeather(req, res) {
	lookupData({
		tableName: 'weather',
		column: 'location_id',
		query: req.query.data.id,

		cacheHit: function (result) {
			let ageOfResults = (Date.now() - result.rows[0].created_at);
			if (ageOfResults > timeouts.weather) {
				deleteData('weather', req.query.data.id).then(() => {
					this.cacheMiss();
				});

			} else {
				res.send(result.rows);
			}
		},

		cacheMiss: function () {
			const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}`;

			superagent.get(url)
				.then(weatherData => {
					const weatherSummaries = weatherData.body.daily.data.map(day => {
						const summary = new Weather(day);
						summary.save(req.query.data.id);
						return summary;
					});
					res.send(weatherSummaries);
				});
		}
	});
}

function getEvent(req, res) {
	lookupData({
		tableName: 'event',
		//this is because in schema we modified table to have a location_id column to make the tables relational.
		column: 'location_id',
		query: req.query.data.id,



		cacheHit: function (result) {
			let eventResults = (Date.now() - result.rows[0].created_at);
			if (eventResults > timeouts.event) {
				deleteData('event', req.query.data.id).then(() => {
					this.cacheMiss();
				})

			} else {
				res.send(result.rows);
			}
		},

		cacheMiss: function () {
			const url = 'https://www.eventbriteapi.com/v3/event/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}'

			superagent.get(url)
				.then(eventData => {
					const eventSlice = eventData.body.events.length > 20 ? 20 : eventData.body.event.length;
					const eventSummary = eventData.body.event.slice(0, eventSlice).map(event => {
						const summary = new Event(event);
						summary.save(req.query.data.id);
						return summary;
					});
					res.send(eventSummary);
				});
		},
	});
}

function getYelp(req, res) {
	lookupData({
		tableName: 'yelp',
		column: 'location_id',
		query: req.query.data.id,

		cacheHit: function (result) {
			let yelpResults = (Date.now() - result.rows[0].created_at);
			if (yelpResults > timeouts.yelp) {
				deleteData('yelp', req.query.data.id).then(() => {
					this.cacheMiss();
				})

			} else {
				res.send(result.rows);
			}
		},

		cacheMiss: function () {
			const url = 'https://api.yelp.com/v3/businesses/search?location=${request.query.data.search_query}'

			superagent.get(url)
				.set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
				.then(yelpData => {
					const yelpSlice = yelpData.body.businesses.length > 20 ? 20 : yelpData.body.businesses.length;
					const yelpBusiness= yelpData.body.businesses.slice(0, yelpSlice).map(business => {
						const newbusiness = new Yelp(business);
						newbusiness.save(req.query.data.id);
						return newbusiness;
					});
					res.send(yelpBusiness);
				});
		},
	});
}

function getMovie(req, res) {
	lookupData({
		tableName: 'movie',
		column: 'location_id',
		query: req.query.data.id,

		cacheHit: function (result) {
			let movieResults = (Date.now() - result.rows[0].created_at);
			if (movieResults > timeouts.movie) {
				deleteData('movie', req.query.data.id).then(() => {
					this.cacheMiss();
				});

			} else {
				res.send(result.rows);
			}
		},

		cacheMiss: function () {
			const url = `https://api.themoviedb.org/3/search/movie/?api_key=${process.env.MOVIE_API_KEY}&language=en-US&page=1&query=${request.query.data.search_query}`;

			superagent.get(url)
				.then(movieData => {
					const movieSlice = movieData.body.results > 20 ? 20 : movieData.body.results.length;
					const movieOverview = movieData.body.results.slice(0, movieSlice).map(movie => {
						const overview = new Movie(movie);
						overview.save(req.query.data.id);
						return overview;
					});
					res.send(movieOverview);
				});
		}
	});
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server is listening on ${PORT}`);
});

